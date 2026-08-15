import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AdminRole, ApiErrorCode } from '@bake-mall/contracts';

import { Address } from '../database/entities/address.entity.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';
import { CartItem } from '../database/entities/cart-item.entity.js';
import { MemberAccount } from '../database/entities/member-account.entity.js';
import { MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';
import { User } from '../database/entities/user.entity.js';
import {
  assertWechatIdentityCompatible,
  buildPhoneLockName,
  mergeCartRows,
  planMergedAddressDefaults,
  UserIdentityMergeService,
  userIdentityConflict,
} from './user-identity-merge.service.js';

const queryBuilder = (rows: unknown[]) => ({
  setLock: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  andWhere: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  addOrderBy: vi.fn().mockReturnThis(),
  getMany: vi.fn().mockResolvedValue(rows),
});

describe('phone advisory lock identity', () => {
  it('uses a fixed-length SHA-256 lock name without plaintext phone', () => {
    const lockName = buildPhoneLockName('13800000000');

    expect(lockName).toMatch(/^phone:[a-f0-9]{58}$/u);
    expect(lockName).toHaveLength(64);
    expect(lockName).not.toContain('13800000000');
    expect(buildPhoneLockName('13800000000')).toBe(lockName);
    expect(buildPhoneLockName('13900000000')).not.toBe(lockName);
  });
});

describe('UserIdentityMergeService phone lock lifecycle', () => {
  it('holds the connection lock across rollback and releases it on failure', async () => {
    const events: string[] = [];
    const manager = {
      getRepository: vi.fn(() => ({
        find: vi.fn().mockResolvedValue([]),
      })),
    };
    const runner = {
      manager,
      connect: vi.fn(async () => events.push('connect')),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('GET_LOCK')) {
          events.push('get-lock');
          return [{ lock_acquired: 1 }];
        }
        events.push('release-lock');
        return [{ lock_released: 1 }];
      }),
      startTransaction: vi.fn(async (): Promise<void> => {
        events.push('start');
      }),
      commitTransaction: vi.fn(async (): Promise<void> => {
        events.push('commit');
      }),
      rollbackTransaction: vi.fn(async (): Promise<void> => {
        events.push('rollback');
      }),
      release: vi.fn(async (): Promise<void> => {
        events.push('release-connection');
      }),
      isTransactionActive: false,
    };
    runner.startTransaction.mockImplementation(async () => {
      runner.isTransactionActive = true;
      events.push('start');
    });
    runner.rollbackTransaction.mockImplementation(async () => {
      runner.isTransactionActive = false;
      events.push('rollback');
    });
    const service = new UserIdentityMergeService(
      { createQueryRunner: vi.fn(() => runner) } as never,
      {} as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.mergeVerifiedPhone({
        authenticatedUserId: '20',
        normalizedPhone: '13800000000',
      }),
    ).rejects.toThrow('User no longer exists');

    expect(events).toEqual([
      'connect',
      'get-lock',
      'start',
      'rollback',
      'release-lock',
      'release-connection',
    ]);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('GET_LOCK'),
      [expect.not.stringContaining('13800000000'), 5],
    );
  });

  it('commits before releasing the named lock on success', async () => {
    const events: string[] = [];
    const runner = {
      manager: {},
      connect: vi.fn(async () => events.push('connect')),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('GET_LOCK')) {
          events.push('get-lock');
          return [{ lock_acquired: 1 }];
        }
        events.push('release-lock');
        return [{ lock_released: 1 }];
      }),
      startTransaction: vi.fn(async (): Promise<void> => {
        events.push('start');
      }),
      commitTransaction: vi.fn(async (): Promise<void> => {
        events.push('commit');
      }),
      rollbackTransaction: vi.fn(),
      release: vi.fn(async (): Promise<void> => {
        events.push('release-connection');
      }),
      isTransactionActive: false,
    };
    const service = new UserIdentityMergeService(
      { createQueryRunner: vi.fn(() => runner) } as never,
      {} as never,
      { record: vi.fn() } as never,
    );

    const result = await service.withPhoneLock(
      '13800000000',
      async ({ manager, mergeVerifiedPhone }) => {
        expect(manager).toBe(runner.manager);
        expect(mergeVerifiedPhone).toEqual(expect.any(Function));
        events.push('operation');
        return 'done';
      },
    );

    expect(result).toBe('done');
    expect(events).toEqual([
      'connect',
      'get-lock',
      'start',
      'operation',
      'commit',
      'release-lock',
      'release-connection',
    ]);
  });

  it('fails closed without starting a transaction when GET_LOCK is unavailable', async () => {
    const runner = {
      manager: {},
      connect: vi.fn(),
      query: vi.fn().mockResolvedValue([{ lock_acquired: 0 }]),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: false,
    };
    const service = new UserIdentityMergeService(
      { createQueryRunner: vi.fn(() => runner) } as never,
      {} as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.mergeVerifiedPhone({
        authenticatedUserId: '20',
        normalizedPhone: '13800000000',
      }),
    ).rejects.toMatchObject({ status: 503 });

    expect(runner.startTransaction).not.toHaveBeenCalled();
    expect(runner.query).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledOnce();
  });
});

describe('UserIdentityMergeService locked candidate validation', () => {
  it('锁后若手机号 owner 不是相同 phone 且未验证 placeholder，则拒绝合并', async () => {
    const source = {
      id: '20',
      phone: null,
      phoneVerified: false,
      isActive: true,
      mergedIntoUserId: null,
    };
    const staleOwner = {
      id: '10',
      phone: '13900000000',
      phoneVerified: false,
      isActive: true,
      mergedIntoUserId: null,
    };
    const users = {
      find: vi
        .fn()
        .mockResolvedValue([source, { ...staleOwner, phone: '13800000000' }]),
      createQueryBuilder: vi.fn(() => queryBuilder([staleOwner, source])),
    };
    const manager = {
      getRepository: vi.fn().mockReturnValue(users),
    };
    const runner = {
      manager,
      connect: vi.fn(),
      query: vi.fn(async (sql: string) =>
        sql.includes('GET_LOCK')
          ? [{ lock_acquired: 1 }]
          : [{ lock_released: 1 }],
      ),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
    };
    const service = new UserIdentityMergeService(
      { createQueryRunner: vi.fn(() => runner) } as never,
      {} as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.mergeVerifiedPhone({
        authenticatedUserId: source.id,
        normalizedPhone: '13800000000',
      }),
    ).rejects.toMatchObject({
      category: 'PHONE_OWNERSHIP',
      counts: { verifiedOrInactiveOwners: 1 },
    });
  });
});

describe('UserIdentityMergeService transaction injection', () => {
  it('uses the provided EntityManager without opening a nested transaction or named lock', async () => {
    const source: {
      id: string;
      phone: string | null;
      phoneVerified: boolean;
      isActive: boolean;
      mergedIntoUserId: string | null;
    } = {
      id: '20',
      phone: null,
      phoneVerified: false,
      isActive: true,
      mergedIntoUserId: null,
    };
    const users = {
      find: vi.fn().mockResolvedValue([source]),
      createQueryBuilder: vi.fn(() => queryBuilder([source])),
    };
    const admins = { createQueryBuilder: vi.fn(() => queryBuilder([])) };
    const manager = {
      getRepository: vi.fn((entity: unknown) =>
        entity === User ? users : admins,
      ),
    };
    const createQueryRunner = vi.fn();
    const service = new UserIdentityMergeService(
      { createQueryRunner } as never,
      {
        applyLockedPhoneIdentity: vi.fn(
          async (user: typeof source, identity: { phone: string }) => {
            user.phone = identity.phone;
            user.phoneVerified = true;
          },
        ),
      } as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.mergeVerifiedPhoneInTransaction(
        {
          authenticatedUserId: source.id,
          normalizedPhone: '13800000000',
        },
        manager as never,
      ),
    ).resolves.toMatchObject({ userId: source.id });
    expect(createQueryRunner).not.toHaveBeenCalled();
  });
});

describe('OPERATOR merge fail-closed', () => {
  it('拒绝把 source OPERATOR 授权无声迁移到 canonical user', async () => {
    const canonical = {
      id: '10',
      phone: '13800000000',
      phoneVerified: false,
      isActive: true,
      mergedIntoUserId: null,
      wechatOpenid: null,
      wechatUnionid: null,
    };
    const source = {
      id: '20',
      phone: null,
      phoneVerified: false,
      isActive: true,
      mergedIntoUserId: null,
      wechatOpenid: 'openid-source',
      wechatUnionid: null,
    };
    const sourceOperator = {
      id: '9',
      role: AdminRole.OPERATOR,
      linkedUserId: source.id,
      isActive: true,
      tokenVersion: 3,
    };
    const users = {
      find: vi.fn().mockResolvedValue([source, canonical]),
      createQueryBuilder: vi.fn(() => queryBuilder([canonical, source])),
    };
    const admins = {
      createQueryBuilder: vi.fn(() => queryBuilder([sourceOperator])),
      save: vi.fn(),
    };
    const unusedRepository = {
      count: vi.fn().mockResolvedValue(0),
      find: vi.fn().mockResolvedValue([]),
    };
    const manager = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === User) return users;
        if (entity === AdminUser) return admins;
        return unusedRepository;
      }),
    };
    const service = new UserIdentityMergeService(
      {} as never,
      { applyLockedPhoneIdentity: vi.fn() } as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.mergeVerifiedPhoneInTransaction(
        {
          authenticatedUserId: source.id,
          normalizedPhone: '13800000000',
        },
        manager as never,
      ),
    ).rejects.toMatchObject({
      category: 'ADMIN_UNIQUENESS',
      counts: { sourceOperators: 1 },
    });

    expect(admins.save).not.toHaveBeenCalled();
    expect(sourceOperator).toMatchObject({
      linkedUserId: source.id,
      isActive: true,
      tokenVersion: 3,
    });
  });
});

describe('phone unique-index defense in depth', () => {
  it('maps ER_DUP_ENTRY only after confirming a competing phone owner', async () => {
    const source = {
      id: '20',
      phone: null,
      phoneVerified: false,
      isActive: true,
      mergedIntoUserId: null,
    };
    const competingOwner = {
      id: '10',
      phone: '13800000000',
      phoneVerified: true,
      isActive: true,
      mergedIntoUserId: null,
    };
    const users = {
      find: vi.fn().mockResolvedValue([source]),
      findOne: vi.fn().mockResolvedValue(competingOwner),
      createQueryBuilder: vi.fn(() => queryBuilder([source])),
    };
    const admins = { createQueryBuilder: vi.fn(() => queryBuilder([])) };
    const manager = {
      getRepository: vi.fn((entity: unknown) =>
        typeof entity === 'function' && entity.name === 'User' ? users : admins,
      ),
    };
    const runner = {
      manager,
      connect: vi.fn(),
      query: vi.fn(async (sql: string) =>
        sql.includes('GET_LOCK')
          ? [{ lock_acquired: 1 }]
          : [{ lock_released: 1 }],
      ),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
    };
    const duplicate = Object.assign(new Error('duplicate'), {
      code: 'ER_DUP_ENTRY',
    });
    const service = new UserIdentityMergeService(
      { createQueryRunner: vi.fn(() => runner) } as never,
      {
        applyLockedPhoneIdentity: vi.fn().mockRejectedValue(duplicate),
      } as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.withPhoneLock('13800000000', ({ mergeVerifiedPhone }) =>
        mergeVerifiedPhone({
          authenticatedUserId: source.id,
          normalizedPhone: '13800000000',
        }),
      ),
    ).rejects.toMatchObject({
      category: 'PHONE_OWNERSHIP',
      counts: { competingOwners: 1 },
    });

    expect(users.findOne).toHaveBeenCalledWith({
      where: { phone: '13800000000' },
      select: {
        id: true,
        phone: true,
        phoneVerified: true,
        isActive: true,
        mergedIntoUserId: true,
      },
    });
  });
});

describe('same-record phone verification audit', () => {
  it('records phone verification without invalidating an independent linked operator', async () => {
    const source: {
      id: string;
      phone: string | null;
      phoneVerified: boolean;
      isActive: boolean;
      mergedIntoUserId: string | null;
    } = {
      id: '20',
      phone: '13900000000',
      phoneVerified: true,
      isActive: true,
      mergedIntoUserId: null,
    };
    const users = {
      find: vi.fn().mockResolvedValue([source]),
      createQueryBuilder: vi.fn(() => queryBuilder([source])),
    };
    const linkedOperator = {
      id: '9',
      role: AdminRole.OPERATOR,
      linkedUserId: source.id,
    };
    const admins = {
      createQueryBuilder: vi.fn(() => queryBuilder([linkedOperator])),
    };
    const manager = {
      getRepository: vi.fn((entity: unknown) =>
        typeof entity === 'function' && entity.name === 'User' ? users : admins,
      ),
    };
    const audit = { record: vi.fn() };
    const applyLockedPhoneIdentity = vi.fn(
      async (user: typeof source, identity: { phone: string }) => {
        user.phone = identity.phone;
        user.phoneVerified = true;
      },
    );
    const runner = {
      manager,
      connect: vi.fn(),
      query: vi.fn(async (sql: string) =>
        sql.includes('GET_LOCK')
          ? [{ lock_acquired: 1 }]
          : [{ lock_released: 1 }],
      ),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: false,
    };
    const service = new UserIdentityMergeService(
      { createQueryRunner: vi.fn(() => runner) } as never,
      { applyLockedPhoneIdentity } as never,
      audit as never,
    );

    const result = await service.withPhoneLock(
      '13800000000',
      ({ mergeVerifiedPhone }) =>
        mergeVerifiedPhone({
          authenticatedUserId: source.id,
          normalizedPhone: '13800000000',
        }),
    );

    expect(result.operatorChanged).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      {
        actor: { type: 'USER', userId: source.id },
        targetEntity: 'users',
        targetId: source.id,
        action: 'USER_PHONE_VERIFIED',
        changeSummary: {
          canonicalUserId: source.id,
          sourceUserId: source.id,
          sameRecord: true,
          operatorChanged: false,
        },
      },
      manager,
    );
    expect(JSON.stringify(audit.record.mock.calls[0]?.[0])).not.toContain(
      '13800000000',
    );
  });
});

describe('successful merge audit summary', () => {
  it('records migrated counts equal to the returned result without sensitive identity or address data', async () => {
    const canonical = {
      id: '10',
      phone: '13800000000',
      phoneVerified: false,
      isActive: true,
      mergedIntoUserId: null,
      tokenVersion: 1,
      wechatOpenid: null,
      wechatUnionid: null,
    };
    const source = {
      id: '20',
      phone: null,
      phoneVerified: false,
      isActive: true,
      mergedIntoUserId: null,
      tokenVersion: 1,
      wechatOpenid: 'secret-openid',
      wechatUnionid: null,
    };
    const address = {
      id: '30',
      userId: source.id,
      detail: 'secret-address',
    };
    const cart = {
      id: '40',
      userId: source.id,
      skuId: '50',
      quantity: 2,
    };
    const users = {
      find: vi.fn().mockResolvedValue([source, canonical]),
      createQueryBuilder: vi.fn(() => queryBuilder([canonical, source])),
    };
    const addresses = {
      createQueryBuilder: vi.fn(() => queryBuilder([address])),
      save: vi.fn(),
    };
    const carts = {
      createQueryBuilder: vi.fn(() => queryBuilder([cart])),
      delete: vi.fn(),
      update: vi.fn(),
    };
    const admins = {
      createQueryBuilder: vi.fn(() => queryBuilder([])),
    };
    const emptyCounts = { count: vi.fn().mockResolvedValue(0) };
    const accounts = { find: vi.fn().mockResolvedValue([]) };
    const manager = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === User) return users;
        if (entity === AdminUser) return admins;
        if (entity === Address) return addresses;
        if (entity === CartItem) return carts;
        if (entity === MemberAccount) return accounts;
        if (
          entity === Order ||
          entity === MembershipPurchaseOrder ||
          entity === UserMembership
        ) {
          return emptyCounts;
        }
        throw new Error(
          `unexpected entity ${(entity as { name?: string }).name}`,
        );
      }),
    };
    const audit = { record: vi.fn() };
    const identities = {
      applyLockedPhoneIdentity: vi.fn(
        async (
          user: typeof canonical | typeof source,
          identity: { phone: string | null; phoneVerified: boolean },
        ) => {
          user.phone = identity.phone;
          user.phoneVerified = identity.phoneVerified;
          return user;
        },
      ),
    };
    const runner = {
      manager,
      connect: vi.fn(),
      query: vi.fn(async (sql: string) =>
        sql.includes('GET_LOCK')
          ? [{ lock_acquired: 1 }]
          : [{ lock_released: 1 }],
      ),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: false,
    };
    const service = new UserIdentityMergeService(
      { createQueryRunner: vi.fn(() => runner) } as never,
      identities as never,
      audit as never,
    );

    const result = await service.mergeVerifiedPhone({
      authenticatedUserId: source.id,
      normalizedPhone: '13800000000',
    });

    expect(result.migrated).toEqual({ addresses: 1, cartItems: 1 });
    expect(audit.record).toHaveBeenCalledWith(
      {
        actor: { type: 'USER', userId: canonical.id },
        targetEntity: 'users',
        targetId: canonical.id,
        action: 'USER_IDENTITY_MERGED',
        changeSummary: {
          canonicalUserId: canonical.id,
          sourceUserId: source.id,
          migrated: result.migrated,
          operatorChanged: false,
        },
      },
      manager,
    );
    expect(JSON.stringify(audit.record.mock.calls[0]?.[0])).not.toMatch(
      /13800000000|secret-openid|secret-address/iu,
    );
  });
});

describe('placeholder identity merge rules', () => {
  it.each([
    {
      name: 'canonical 已有默认时保留其最小 id，并清除两侧其余默认',
      rows: [
        { id: '12', userId: '10', isDefault: true },
        { id: '11', userId: '10', isDefault: true },
        { id: '22', userId: '20', isDefault: true },
        { id: '21', userId: '20', isDefault: true },
      ],
      expectedDefaultId: '11',
    },
    {
      name: 'canonical 无默认时保留 source 的最小 id 默认',
      rows: [
        { id: '12', userId: '10', isDefault: false },
        { id: '22', userId: '20', isDefault: true },
        { id: '21', userId: '20', isDefault: true },
      ],
      expectedDefaultId: '21',
    },
    {
      name: '两侧均无默认时不新增默认',
      rows: [
        { id: '11', userId: '10', isDefault: false },
        { id: '21', userId: '20', isDefault: false },
      ],
      expectedDefaultId: undefined,
    },
  ])('$name，最终默认地址不超过一个', ({ rows, expectedDefaultId }) => {
    const plan = planMergedAddressDefaults(rows, '10', '20');

    expect(plan.filter(({ isDefault }) => isDefault)).toEqual(
      expectedDefaultId
        ? [expect.objectContaining({ id: expectedDefaultId })]
        : [],
    );
    expect(plan).toHaveLength(rows.length);
    expect(plan.map(({ id }) => id)).toEqual(rows.map(({ id }) => id));
  });

  it('接受相同或单边微信 identity，并拒绝双方不同的非空值', () => {
    expect(() =>
      assertWechatIdentityCompatible(
        { wechatOpenid: 'same', wechatUnionid: null },
        { wechatOpenid: 'same', wechatUnionid: 'union' },
      ),
    ).not.toThrow();

    expect(() =>
      assertWechatIdentityCompatible(
        { wechatOpenid: 'left', wechatUnionid: null },
        { wechatOpenid: 'right', wechatUnionid: null },
      ),
    ).toThrow(ConflictException);
  });

  it('购物车按稳定 SKU 顺序合并，相同 SKU 数量相加且不同 SKU 重挂', () => {
    expect(
      mergeCartRows(
        [
          { id: '10', userId: '1', skuId: '2', quantity: 3 },
          { id: '11', userId: '1', skuId: '4', quantity: 1 },
        ],
        [
          { id: '20', userId: '2', skuId: '2', quantity: 5 },
          { id: '21', userId: '2', skuId: '3', quantity: 2 },
        ],
        '1',
      ),
    ).toEqual({
      updates: [
        { id: '10', quantity: 8, userId: '1' },
        { id: '21', quantity: 2, userId: '1' },
      ],
      deleteIds: ['20'],
    });
  });

  it('购物车合并超过既有 99 上限时返回确定性人工处理冲突', () => {
    expect(() =>
      mergeCartRows(
        [{ id: '10', userId: '1', skuId: '2', quantity: 60 }],
        [{ id: '20', userId: '2', skuId: '2', quantity: 40 }],
        '1',
      ),
    ).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({
          code: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
        }),
      }),
    );
  });

  it.each([0, -1, 1.5, 100])(
    '无 canonical cart row 时也拒绝非法 source quantity=%s',
    (quantity) => {
      expect(() =>
        mergeCartRows(
          [],
          [{ id: '20', userId: '2', skuId: '2', quantity }],
          '1',
        ),
      ).toThrowError(
        expect.objectContaining({
          response: expect.objectContaining({
            code: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
          }),
        }),
      );
    },
  );

  it.each([
    ['FINANCIAL_FACTS', ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW],
    ['WECHAT_IDENTITY', ApiErrorCode.WECHAT_IDENTITY_CONFLICT],
    ['ADMIN_UNIQUENESS', ApiErrorCode.ADMIN_USER_CONFLICT],
  ] as const)('为 %s 暴露共享确定性错误码', (category, code) => {
    const error = userIdentityConflict(category, { blockingCount: 1 });
    expect(error.getResponse()).toMatchObject({ code, category });
  });
});
