import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiErrorCode,
  BooleanFilter,
  MembershipLevelStatus,
  MembershipTheme,
  type SaveMembershipLevelRequest,
} from '@bake-mall/contracts';
import { QueryFailedError } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { MembershipLevel } from '../database/entities/membership-level.entity.js';
import { MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';
import { MembershipService } from './membership.service.js';

const createdAt = new Date('2026-07-21T08:00:00.000Z');
const updatedAt = new Date('2026-07-21T09:00:00.000Z');

const request = (
  overrides: Partial<SaveMembershipLevelRequest> = {},
): SaveMembershipLevelRequest => ({
  code: 'GOLD',
  name: '鎏金会员',
  subtitle: '更好一点',
  description: '全场优惠',
  rank: 20,
  priceCents: 50_000,
  grantCreditCents: 60_000,
  discountBasisPoints: 9_500,
  validDays: 365,
  benefits: [{ title: '全场九五折', sortOrder: 10 }],
  cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'GOLD MEMBER' },
  sortOrder: 20,
  status: MembershipLevelStatus.ACTIVE,
  ...overrides,
});

const storedLevel = (overrides: Record<string, unknown> = {}) => ({
  id: 'level-1',
  ...request(),
  theme: MembershipTheme.CHAMPAGNE,
  badgeText: 'GOLD MEMBER',
  isActive: true,
  version: 3,
  createdAt,
  updatedAt,
  ...overrides,
});

const buildService = (
  level: Record<string, unknown> | null = null,
  purchaseCount = 0,
) => {
  const saved = vi.fn(async (value: Record<string, unknown>) => ({
    ...value,
    id: value.id ?? 'level-1',
    version: value.version ?? 1,
    createdAt,
    updatedAt,
  }));
  const queryBuilder = {
    leftJoin: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    getCount: vi.fn().mockResolvedValue(level ? 1 : 0),
    getRawAndEntities: vi.fn().mockResolvedValue({
      entities: level ? [level] : [],
      raw: level ? [{ level_id: level.id, purchaseCount: '0' }] : [],
    }),
  };
  const levelRepository = {
    find: vi.fn().mockResolvedValue(level ? [level] : []),
    findOne: vi.fn().mockResolvedValue(level),
    createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    findOneBy: vi.fn().mockResolvedValue(level),
    create: vi.fn((value: Record<string, unknown>) => value),
    save: saved,
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const purchaseRepository = {
    count: vi.fn().mockResolvedValue(purchaseCount),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const repositories = new Map<unknown, object>([
    [MembershipLevel, levelRepository],
    [MembershipPurchaseOrder, purchaseRepository],
  ]);
  const manager = {
    getRepository: vi.fn((entity: unknown) => repositories.get(entity)),
  };
  const transaction = vi.fn(
    async (operation: (transactionManager: typeof manager) => unknown) =>
      operation(manager),
  );
  const service = new MembershipService(
    levelRepository as never,
    purchaseRepository as never,
    audit as never,
    { transaction } as never,
  );

  return {
    service,
    levelRepository,
    purchaseRepository,
    queryBuilder,
    audit,
    transaction,
    manager,
  };
};

describe('MembershipService level management', () => {
  it('only exposes active levels to the public in configured display order', async () => {
    const active = storedLevel();
    const inactive = storedLevel({ id: 'level-2', isActive: false });
    const { service, levelRepository } = buildService();
    levelRepository.find.mockResolvedValueOnce([active]);

    const [publicLevel] = await service.listPublicLevels();

    expect(publicLevel).toMatchObject({
      id: 'level-1',
      cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'GOLD MEMBER' },
    });
    expect(publicLevel).not.toHaveProperty('status');
    expect(levelRepository.find).toHaveBeenCalledWith({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
    void inactive;
  });

  it('pushes combined membership-level filters, aggregate sales state, stable paging, and exclusive time bounds into SQL', async () => {
    const level = storedLevel();
    const { service, queryBuilder } = buildService(level);
    queryBuilder.getCount.mockResolvedValueOnce(7);
    queryBuilder.getRawAndEntities.mockResolvedValueOnce({
      entities: [level],
      raw: [{ level_id: level.id, purchaseCount: '3' }],
    });

    await expect(
      service.listAdminLevels({
        q: '  GOLD%_  ',
        status: MembershipLevelStatus.ACTIVE,
        rank: 20,
        minPriceCents: 10_000,
        maxPriceCents: 50_000,
        minDiscountBasisPoints: 9_000,
        maxDiscountBasisPoints: 9_500,
        hasPurchases: BooleanFilter.YES,
        theme: MembershipTheme.CHAMPAGNE,
        minValidDays: 30,
        maxValidDays: 365,
        updatedAtFrom: '2026-07-01T00:00:00.000Z',
        updatedAtBefore: '2026-08-01T00:00:00.000Z',
        page: 2,
        pageSize: 20,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: level.id, purchaseCount: 3 })],
      total: 7,
      page: 2,
      pageSize: 20,
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("LIKE :q ESCAPE '\\\\'"),
      { q: '%GOLD\\%\\_%' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'level.updatedAt < :updatedAtBefore',
      { updatedAtBefore: new Date('2026-08-01T00:00:00.000Z') },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'level.isActive = :isActive',
      {
        isActive: true,
      },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('EXISTS'),
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('level.sortOrder', 'ASC');
    expect(queryBuilder.addOrderBy).toHaveBeenNthCalledWith(
      1,
      'level.createdAt',
      'DESC',
    );
    expect(queryBuilder.addOrderBy).toHaveBeenNthCalledWith(
      2,
      'level.id',
      'DESC',
    );
    expect(queryBuilder.skip).toHaveBeenCalledWith(20);
    expect(queryBuilder.take).toHaveBeenCalledWith(20);
  });

  it('creates a level and its audit record in the same transaction', async () => {
    const { service, audit, transaction, manager } = buildService();

    await expect(service.createLevel(request(), 'admin-1')).resolves.toEqual(
      expect.objectContaining({
        code: 'GOLD',
        status: MembershipLevelStatus.ACTIVE,
      }),
    );
    expect(transaction).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'ADMIN', adminUserId: 'admin-1' },
        targetEntity: 'membership_levels',
        targetId: 'level-1',
        action: 'MEMBERSHIP_LEVEL_CREATED',
      }),
      manager,
    );
  });

  it('rejects an update made from a stale level version', async () => {
    const { service } = buildService(storedLevel());

    await expect(
      service.updateLevel('level-1', request({ version: 2 }), 'admin-1'),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT,
      });
      return true;
    });
  });

  it('uses the submitted version as an atomic update condition', async () => {
    const { service, levelRepository } = buildService(storedLevel());

    await service.updateLevel('level-1', request({ version: 3 }), 'admin-1');

    expect(levelRepository.update).toHaveBeenCalledWith(
      { id: 'level-1', version: 3 },
      expect.objectContaining({ name: '鎏金会员' }),
    );
  });

  it('rejects a concurrent update that no longer matches the submitted version', async () => {
    const { service, levelRepository } = buildService(storedLevel());
    levelRepository.update.mockResolvedValueOnce({ affected: 0 });

    await expect(
      service.updateLevel('level-1', request({ version: 3 }), 'admin-1'),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT,
      });
      return true;
    });
  });

  it('rejects activating a level without benefits while permitting an inactive draft', async () => {
    const { service } = buildService();

    await expect(
      service.createLevel(request({ benefits: [] }), 'admin-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.createLevel(
        request({ benefits: [], status: MembershipLevelStatus.INACTIVE }),
        'admin-1',
      ),
    ).resolves.toMatchObject({ status: MembershipLevelStatus.INACTIVE });
  });

  it.each([
    ['code', 'uniq_membership_levels_code', { code: 'GOLD' }],
    ['rank', 'uniq_membership_levels_rank', { rank: 20 }],
  ] as const)(
    'translates a duplicate %s create into a displayable conflict',
    async (_field, constraint, details) => {
      const { service, levelRepository } = buildService();
      levelRepository.save.mockRejectedValueOnce(
        new QueryFailedError(
          'INSERT INTO membership_levels',
          [],
          Object.assign(new Error('Duplicate entry'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
            sqlMessage: `Duplicate entry for key '${constraint}'`,
          }),
        ),
      );

      await expect(service.createLevel(request(), 'admin-1')).rejects.toSatisfy(
        (error: ConflictException) => {
          expect(error.getResponse()).toMatchObject({
            code: ApiErrorCode.MEMBERSHIP_LEVEL_CONFLICT,
            details,
          });
          return true;
        },
      );
    },
  );

  it('translates a duplicate rank update into a displayable conflict', async () => {
    const { service, levelRepository } = buildService(storedLevel());
    levelRepository.update.mockRejectedValueOnce(
      new QueryFailedError(
        'UPDATE membership_levels',
        [],
        Object.assign(new Error('Duplicate entry'), {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
          sqlMessage:
            "Duplicate entry '20' for key 'membership_levels.uniq_membership_levels_rank'",
        }),
      ),
    );

    await expect(
      service.updateLevel('level-1', request({ version: 3 }), 'admin-1'),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBERSHIP_LEVEL_CONFLICT,
        details: { rank: 20 },
      });
      return true;
    });
  });

  it('rejects deleting an active level even when it has no purchase history', async () => {
    const { service, levelRepository } = buildService(storedLevel());

    await expect(service.deleteLevel('level-1', 'admin-1')).rejects.toSatisfy(
      (error: UnprocessableEntityException) => {
        expect(error.getResponse()).toMatchObject({
          message: '已售会员等级不可删除，请改为下架',
        });
        return true;
      },
    );
    expect(levelRepository.delete).not.toHaveBeenCalled();
  });

  it('rechecks level status under a pessimistic write lock before deleting', async () => {
    const inactive = storedLevel({ isActive: false });
    const concurrentlyActivated = storedLevel({ isActive: true, version: 4 });
    const { service, levelRepository } = buildService(inactive);
    levelRepository.findOne.mockResolvedValueOnce(concurrentlyActivated);

    await expect(
      service.deleteLevel('level-1', 'admin-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(levelRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'level-1' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(levelRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes an inactive unsold level and records the audit in the transaction', async () => {
    const { service, levelRepository, audit, manager } = buildService(
      storedLevel({ isActive: false }),
    );

    await expect(
      service.deleteLevel('level-1', 'admin-1'),
    ).resolves.toBeUndefined();
    expect(levelRepository.delete).toHaveBeenCalledWith('level-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'ADMIN', adminUserId: 'admin-1' },
        targetId: 'level-1',
        action: 'MEMBERSHIP_LEVEL_DELETED',
      }),
      manager,
    );
  });

  it('does not delete a level that has purchase history', async () => {
    const { service } = buildService(storedLevel({ isActive: false }), 1);

    await expect(
      service.deleteLevel('level-1', 'admin-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('translates an FK race after the purchase count into the sold-level error', async () => {
    const { service, levelRepository } = buildService(
      storedLevel({ isActive: false }),
    );
    levelRepository.delete.mockRejectedValueOnce(
      new QueryFailedError(
        'DELETE FROM membership_levels',
        [],
        Object.assign(new Error('Cannot delete referenced row'), {
          code: 'ER_ROW_IS_REFERENCED_2',
          errno: 1451,
        }),
      ),
    );

    await expect(service.deleteLevel('level-1', 'admin-1')).rejects.toSatisfy(
      (error: UnprocessableEntityException) => {
        expect(error.getResponse()).toMatchObject({
          message: '已售会员等级不可删除，请改为下架',
        });
        return true;
      },
    );
  });
});
