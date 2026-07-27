import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  ApiErrorCode,
  BooleanFilter,
  MemberCreditGrantStatus,
  MembershipEntitlementSegmentKind,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipPurchaseVoidReasonCode,
  MembershipStatus,
  MembershipTheme,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { MemberAccount } from '../database/entities/member-account.entity.js';
import { MemberCreditEntry } from '../database/entities/member-credit-entry.entity.js';
import { MemberCreditGrant } from '../database/entities/member-credit-grant.entity.js';
import { MembershipEntitlementSegment } from '../database/entities/membership-entitlement-segment.entity.js';
import { IdempotencyRecord } from '../database/entities/idempotency-record.entity.js';
import { MembershipLevel } from '../database/entities/membership-level.entity.js';
import { MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';
import { User } from '../database/entities/user.entity.js';
import { MembershipCreditService } from './membership-credit.service.js';
import { MembershipEntitlementService } from './membership-entitlement.service.js';
import { MembershipPurchaseService } from './membership-purchase.service.js';

const now = new Date('2026-07-21T08:00:00.000Z');

const activeLevel = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'level-gold',
    code: 'GOLD',
    name: '鎏金会员',
    rank: 20,
    priceCents: 50_000,
    grantCreditCents: 60_000,
    discountBasisPoints: 9_500,
    validDays: 365,
    benefits: [{ title: '全场九五折', sortOrder: 10 }],
    theme: MembershipTheme.CHAMPAGNE,
    badgeText: 'GOLD',
    isActive: true,
    ...overrides,
  }) as MembershipLevel;

const buildService = ({
  level = activeLevel(),
  purchase = null,
  account = null,
  activeMembership = null,
  previousMembership = null,
  grant = null,
  segment = null,
  simulatedPaymentEnabled = true,
}: {
  level?: MembershipLevel | null;
  purchase?: MembershipPurchaseOrder | null;
  account?: MemberAccount | null;
  activeMembership?: UserMembership | null;
  previousMembership?: UserMembership | null;
  grant?: MemberCreditGrant | null;
  segment?: MembershipEntitlementSegment | null;
  simulatedPaymentEnabled?: boolean;
} = {}) => {
  const savedPurchases: Record<string, unknown>[] = [];
  const savedMemberships: Record<string, unknown>[] = [];
  const savedAccounts: Record<string, unknown>[] = [];
  const savedGrants: Record<string, unknown>[] = [];
  const savedEntries: Record<string, unknown>[] = [];
  const levelRepository = {
    findOne: vi.fn().mockResolvedValue(level),
    findOneBy: vi.fn().mockResolvedValue(level),
    find: vi.fn().mockResolvedValue(level ? [level] : []),
  };
  const purchaseQueryBuilder = {
    innerJoin: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(purchase ? [purchase] : []),
    getManyAndCount: vi
      .fn()
      .mockResolvedValue([purchase ? [purchase] : [], purchase ? 1 : 0]),
  };
  const purchaseRepository = {
    find: vi.fn().mockResolvedValue(purchase ? [purchase] : []),
    findOne: vi.fn().mockResolvedValue(purchase),
    createQueryBuilder: vi.fn().mockReturnValue(purchaseQueryBuilder),
    findOneBy: vi.fn().mockResolvedValue(purchase),
    create: vi.fn((value: Record<string, unknown>) => value),
    save: vi.fn(async (value: Record<string, unknown>) => {
      const saved = {
        ...value,
        id: value.id ?? 'purchase-1',
        purchaseNo: value.purchaseNo ?? 'MP202607210001',
        createdAt: value.createdAt ?? now,
        updatedAt: now,
      };
      savedPurchases.push(saved);
      return saved;
    }),
  };
  const accountRepository = {
    findOne: vi.fn().mockResolvedValue(account),
    findOneBy: vi.fn().mockResolvedValue(account),
    create: vi.fn((value: Record<string, unknown>) => value),
    save: vi.fn(async (value: Record<string, unknown>) => {
      const saved = { ...value, id: value.id ?? 'account-1', version: 1 };
      savedAccounts.push(saved);
      return saved;
    }),
  };
  const membershipRepository = {
    find: vi.fn(async () => (activeMembership ? [activeMembership] : [])),
    findOne: vi.fn(async (input: { where?: Record<string, unknown> } = {}) => {
      const id = input?.where?.id;
      if (id && activeMembership?.id === id) return activeMembership;
      if (id && previousMembership?.id === id) return previousMembership;
      return activeMembership;
    }),
    findOneBy: vi.fn(async (where: Record<string, unknown>) =>
      where.id === previousMembership?.id
        ? previousMembership
        : activeMembership,
    ),
    create: vi.fn((value: Record<string, unknown>) => value),
    save: vi.fn(async (value: Record<string, unknown>) => {
      const saved = { ...value, id: value.id ?? 'membership-1' };
      savedMemberships.push(saved);
      return saved;
    }),
  };
  const grantRepository = {
    findOneBy: vi.fn().mockResolvedValue(grant),
    create: vi.fn((value: Record<string, unknown>) => value),
    save: vi.fn(async (value: Record<string, unknown>) => {
      const saved = { ...value, id: value.id ?? 'grant-1' };
      savedGrants.push(saved);
      return saved;
    }),
  };
  const entryRepository = {
    find: vi.fn().mockResolvedValue([]),
    create: vi.fn((value: Record<string, unknown>) => value),
    save: vi.fn(async (value: Record<string, unknown>) => {
      const saved = { ...value, id: value.id ?? 'entry-1', createdAt: now };
      savedEntries.push(saved);
      return saved;
    }),
  };
  const segmentRepository = {
    findOne: vi.fn(
      async (
        input: {
          where?: Record<string, unknown>;
        } = {},
      ) => {
        const where = input?.where ?? {};
        // Locate by purchaseOrderId returns the segment for that purchase.
        if (where.purchaseOrderId !== undefined) return segment;
        // Chain-tail lookup by membershipId returns the same segment when it is
        // the only/latest one for the membership.
        if (where.membershipId !== undefined) return segment;
        return segment;
      },
    ),
    findOneBy: vi.fn(async (where: Record<string, unknown>) =>
      where?.purchaseOrderId !== undefined ? segment : null,
    ),
    create: vi.fn((value: Record<string, unknown>) => value),
    save: vi.fn(async (value: Record<string, unknown>) => ({
      ...value,
      id: 'segment-1',
    })),
  };
  const idempotencyRepository = {
    findOneBy: vi.fn().mockResolvedValue(null),
    create: vi.fn((value: Record<string, unknown>) => value),
    save: vi.fn(async (value: Record<string, unknown>) => ({
      ...value,
      id: 'idempotency-1',
    })),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const orderRepository = { existsBy: vi.fn().mockResolvedValue(false) };
  const userRepository = {
    findOne: vi.fn().mockResolvedValue({ id: 'user-1' }),
  };
  const repositories = new Map<unknown, object>([
    [MembershipLevel, levelRepository],
    [MembershipPurchaseOrder, purchaseRepository],
    [MemberAccount, accountRepository],
    [UserMembership, membershipRepository],
    [MemberCreditGrant, grantRepository],
    [MemberCreditEntry, entryRepository],
    [MembershipEntitlementSegment, segmentRepository],
    [IdempotencyRecord, idempotencyRepository],
    [Order, orderRepository],
    [User, userRepository],
  ]);
  const manager = {
    getRepository: vi.fn((entity: unknown) => repositories.get(entity)),
  };
  const entitlement = {
    applyPaidPurchase: vi.fn(async (_manager, input) => ({
      account: input.account,
      membership: activeMembership ?? {
        id: 'membership-1',
        userId: input.purchase.userId,
      },
    })),
    restoreVoidedPurchase: vi.fn(async (_manager, input) => ({
      account: input.account,
      membership: previousMembership ??
        activeMembership ?? {
          id: 'membership-restored',
          userId: input.purchase.userId,
        },
      voidedMembership: activeMembership ?? null,
    })),
  };
  const credit = {
    lockOrCreateAccount: vi.fn(
      async () =>
        account ?? {
          id: 'account-1',
          userId: 'user-1',
          activeMembershipId: null,
          availableCreditCents: 0,
        },
    ),
    grantMembershipPurchase: vi.fn(async () => ({
      account,
      entry: null,
      allocations: [],
    })),
    reverseUnusedMembershipPurchaseGrant: vi.fn(async (_manager, acct) => ({
      account: acct,
      entry: null,
      allocations: [],
    })),
  };
  const service = new MembershipPurchaseService(
    purchaseRepository as never,
    levelRepository as never,
    accountRepository as never,
    membershipRepository as never,
    grantRepository as never,
    entryRepository as never,
    idempotencyRepository as never,
    segmentRepository as never,
    orderRepository as never,
    {
      transaction: async (
        operation: (transactionManager: typeof manager) => unknown,
      ) => operation(manager),
    } as never,
    entitlement as unknown as MembershipEntitlementService,
    credit as unknown as MembershipCreditService,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
    {
      get: () => ({
        NODE_ENV: 'test',
        SIMULATED_PAYMENT_ENABLED: simulatedPaymentEnabled,
      }),
    } as never,
    () => now,
  );
  return {
    service,
    purchaseRepository,
    purchaseQueryBuilder,
    orderRepository,
    savedPurchases,
    savedMemberships,
    savedAccounts,
    savedGrants,
    savedEntries,
    entitlement,
    credit,
    membershipRepository,
  };
};

describe('MembershipPurchaseService', () => {
  it('pushes purchase filters, user phone JOIN, stable paging, and exclusive time bounds into SQL', async () => {
    const purchase = {
      id: 'purchase-1',
      userId: 'user-1',
      purchaseNo: 'MP202607210001',
      membershipLevelId: 'level-gold',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      priceCents: 50_000,
      grantCreditCents: 60_000,
      discountBasisPoints: 9_500,
      validDays: 365,
      theme: MembershipTheme.CHAMPAGNE,
      badgeText: 'GOLD',
      status: MembershipPurchaseStatus.PENDING,
      paymentStatus: MembershipPaymentStatus.PENDING,
      paidAt: null,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    } as MembershipPurchaseOrder;
    const { service, purchaseQueryBuilder } = buildService({ purchase });
    purchaseQueryBuilder.getManyAndCount.mockResolvedValueOnce([[purchase], 4]);

    await expect(
      service.listAdminPurchases({
        purchaseNo: '  001%_  ',
        userPhone: '  138%  ',
        userId: ' user-1 ',
        levelId: ' level-gold ',
        status: MembershipPurchaseStatus.PENDING,
        paymentStatus: MembershipPaymentStatus.PENDING,
        minPriceCents: 40_000,
        maxPriceCents: 50_000,
        createdAtFrom: '2026-07-01T00:00:00.000Z',
        createdAtBefore: '2026-08-01T00:00:00.000Z',
        paidAtFrom: '2026-07-02T00:00:00.000Z',
        paidAtBefore: '2026-08-02T00:00:00.000Z',
        voidedAtFrom: '2026-07-03T00:00:00.000Z',
        voidedAtBefore: '2026-08-03T00:00:00.000Z',
        page: 2,
        pageSize: 10,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: purchase.id, userId: 'user-1' })],
      total: 4,
      page: 2,
      pageSize: 10,
    });
    expect(purchaseQueryBuilder.innerJoin).toHaveBeenCalledWith(
      User,
      'user',
      'user.id = purchase.userId',
    );
    expect(purchaseQueryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(
        "purchase.purchaseNo LIKE :purchaseNo ESCAPE '\\\\'",
      ),
      { purchaseNo: '%001\\%\\_%' },
    );
    expect(purchaseQueryBuilder.andWhere).toHaveBeenCalledWith(
      'purchase.createdAt < :createdAtBefore',
      { createdAtBefore: new Date('2026-08-01T00:00:00.000Z') },
    );
    expect(purchaseQueryBuilder.andWhere).toHaveBeenCalledWith(
      'purchase.paidAt < :paidAtBefore',
      { paidAtBefore: new Date('2026-08-02T00:00:00.000Z') },
    );
    expect(purchaseQueryBuilder.andWhere).toHaveBeenCalledWith(
      'purchase.voidedAt < :voidedAtBefore',
      { voidedAtBefore: new Date('2026-08-03T00:00:00.000Z') },
    );
    expect(purchaseQueryBuilder.orderBy).toHaveBeenCalledWith(
      'purchase.createdAt',
      'DESC',
    );
    expect(purchaseQueryBuilder.addOrderBy).toHaveBeenCalledWith(
      'purchase.id',
      'DESC',
    );
    expect(purchaseQueryBuilder.skip).toHaveBeenCalledWith(10);
    expect(purchaseQueryBuilder.take).toHaveBeenCalledWith(10);
  });

  it('filters voidability before paging so total and page contents use business-rule results', async () => {
    const purchases = ['purchase-3', 'purchase-2', 'purchase-1'].map(
      (id) =>
        ({
          id,
          userId: 'user-1',
          purchaseNo: id,
          membershipLevelId: 'level-gold',
          levelCode: 'GOLD',
          levelName: '鎏金会员',
          levelRank: 20,
          priceCents: 50_000,
          grantCreditCents: 0,
          discountBasisPoints: 9_500,
          validDays: 365,
          theme: MembershipTheme.CHAMPAGNE,
          badgeText: 'GOLD',
          status: MembershipPurchaseStatus.FULFILLED,
          paymentStatus: MembershipPaymentStatus.SUCCEEDED,
          paidAt: now,
          voidedAt: null,
          createdAt: now,
          updatedAt: now,
        }) as MembershipPurchaseOrder,
    );
    const { service, purchaseQueryBuilder } = buildService();
    purchaseQueryBuilder.getMany.mockResolvedValueOnce(purchases);
    const voidabilityOf = vi
      .spyOn(
        service as unknown as {
          voidabilityOf: (purchase: MembershipPurchaseOrder) => Promise<{
            allowed: boolean;
            reasonCode?: never;
            reason?: never;
          }>;
        },
        'voidabilityOf',
      )
      .mockImplementation(async ({ id }) => ({ allowed: id !== 'purchase-2' }));

    await expect(
      service.listAdminPurchases({
        voidable: BooleanFilter.YES,
        page: 2,
        pageSize: 1,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: 'purchase-1' })],
      total: 2,
      page: 2,
      pageSize: 1,
    });
    expect(purchaseQueryBuilder.andWhere).toHaveBeenCalledWith(
      'purchase.status = :voidableStatus',
      { voidableStatus: MembershipPurchaseStatus.FULFILLED },
    );
    expect(purchaseQueryBuilder.andWhere).toHaveBeenCalledWith(
      'purchase.paymentStatus = :voidablePaymentStatus',
      { voidablePaymentStatus: MembershipPaymentStatus.SUCCEEDED },
    );
    expect(purchaseQueryBuilder.skip).not.toHaveBeenCalled();
    expect(purchaseQueryBuilder.take).not.toHaveBeenCalled();
    expect(voidabilityOf).toHaveBeenCalledTimes(3);
  });

  it('reports fulfilled purchases as voidable only when their grant and membership chain remain unused', async () => {
    const purchase = {
      id: 'purchase-1',
      userId: 'user-1',
      purchaseNo: 'MP202607210001',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      priceCents: 50_000,
      grantCreditCents: 60_000,
      discountBasisPoints: 9_500,
      validDays: 365,
      theme: MembershipTheme.CHAMPAGNE,
      badgeText: 'GOLD',
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
      createdAt: now,
      updatedAt: now,
    } as MembershipPurchaseOrder;
    const { service } = buildService({
      purchase,
      activeMembership: {
        id: 'membership-current',
        userId: 'user-1',
        purchaseOrderId: 'purchase-1',
        membershipLevelId: 'level-gold',
        levelCode: 'GOLD',
        levelName: '鎏金会员',
        levelRank: 20,
        discountBasisPoints: 9_500,
        benefits: [],
        theme: MembershipTheme.CHAMPAGNE,
        badgeText: 'GOLD',
        startsAt: now,
        endsAt: new Date('2027-07-21T08:00:00.000Z'),
        previousMembershipId: null,
        status: MembershipStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
      } as unknown as UserMembership,
      segment: {
        id: 'segment-1',
        membershipId: 'membership-current',
        purchaseOrderId: 'purchase-1',
        kind: MembershipEntitlementSegmentKind.INITIAL,
        startsAt: now,
        endsAt: new Date('2027-07-21T08:00:00.000Z'),
        previousMembershipId: null,
        previousMembershipEndsAt: null,
        createdAt: now,
      } as MembershipEntitlementSegment,
      grant: {
        id: 'grant-1',
        accountId: 'account-1',
        purchaseOrderId: 'purchase-1',
        grantedCents: 60_000,
        remainingCents: 60_000,
        status: MemberCreditGrantStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
      } as MemberCreditGrant,
      account: {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: 'membership-current',
      } as MemberAccount,
    });

    await expect(service.getAdminPurchase('purchase-1')).resolves.toMatchObject(
      {
        purchase: { id: 'purchase-1', userId: 'user-1' },
        voidability: { allowed: true },
        segment: { id: 'segment-1' },
        grant: { id: 'grant-1' },
      },
    );
  });

  it('reports an old LOW renewal as not restorable after a HIGH upgrade becomes active', async () => {
    const purchase = {
      id: 'purchase-low-renewal',
      userId: 'user-1',
      purchaseNo: 'MP202607210001',
      levelCode: 'LOW',
      levelName: '低卡续费',
      levelRank: 20,
      priceCents: 50_000,
      grantCreditCents: 60_000,
      discountBasisPoints: 9_500,
      validDays: 30,
      benefits: [],
      theme: MembershipTheme.CHAMPAGNE,
      badgeText: 'LOW',
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
      paidAt: now,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    } as unknown as MembershipPurchaseOrder;
    const { service } = buildService({
      purchase,
      activeMembership: {
        id: 'membership-low',
        userId: 'user-1',
        purchaseOrderId: 'purchase-low-initial',
        membershipLevelId: 'level-low',
        levelCode: 'LOW',
        levelName: '低卡',
        levelRank: 20,
        discountBasisPoints: 9_500,
        benefits: [],
        theme: MembershipTheme.CHAMPAGNE,
        badgeText: 'LOW',
        startsAt: new Date('2026-06-21T08:00:00.000Z'),
        endsAt: new Date('2026-08-20T08:00:00.000Z'),
        previousMembershipId: null,
        status: MembershipStatus.REPLACED,
        createdAt: now,
        updatedAt: now,
      } as unknown as UserMembership,
      segment: {
        id: 'segment-low-tail',
        membershipId: 'membership-low',
        purchaseOrderId: purchase.id,
        kind: MembershipEntitlementSegmentKind.RENEWAL,
        startsAt: now,
        endsAt: new Date('2026-08-20T08:00:00.000Z'),
        previousMembershipId: null,
        previousMembershipEndsAt: null,
        createdAt: now,
      } as MembershipEntitlementSegment,
      grant: {
        id: 'grant-low-renewal',
        accountId: 'account-1',
        purchaseOrderId: purchase.id,
        grantedCents: 60_000,
        remainingCents: 60_000,
        status: MemberCreditGrantStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
      } as MemberCreditGrant,
      account: {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: 'membership-high',
        availableCreditCents: 120_000,
      } as MemberAccount,
    });

    await expect(service.getAdminPurchase(purchase.id)).resolves.toMatchObject({
      voidability: {
        allowed: false,
        reasonCode:
          MembershipPurchaseVoidReasonCode.MEMBERSHIP_CHAIN_NOT_RESTORABLE,
        reason: '当前购卡记录已不是全局会员链末端，无法恢复',
      },
    });
  });

  it('refuses to void a purchase whose membership snapshot is already used by an order', async () => {
    const { service, orderRepository } = buildService({
      purchase: {
        id: 'purchase-1',
        userId: 'user-1',
        status: MembershipPurchaseStatus.FULFILLED,
        paymentStatus: MembershipPaymentStatus.SUCCEEDED,
        grantCreditCents: 60_000,
      } as MembershipPurchaseOrder,
      segment: {
        id: 'segment-1',
        membershipId: 'membership-current',
        purchaseOrderId: 'purchase-1',
      } as MembershipEntitlementSegment,
      grant: {
        purchaseOrderId: 'purchase-1',
        grantedCents: 60_000,
        remainingCents: 60_000,
      } as MemberCreditGrant,
      account: {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: 'membership-current',
        availableCreditCents: 60_000,
      } as MemberAccount,
      activeMembership: {
        id: 'membership-current',
        purchaseOrderId: 'purchase-1',
      } as unknown as UserMembership,
    });
    orderRepository.existsBy.mockResolvedValueOnce(true);

    await expect(
      service.voidPurchase('purchase-1', 'admin-1'),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
      });
      return true;
    });
  });

  it('refuses to void a membership-local tail after another membership becomes the global active tail', async () => {
    const { service, credit, entitlement } = buildService({
      purchase: {
        id: 'purchase-low-renewal',
        userId: 'user-1',
        status: MembershipPurchaseStatus.FULFILLED,
        paymentStatus: MembershipPaymentStatus.SUCCEEDED,
        grantCreditCents: 60_000,
      } as MembershipPurchaseOrder,
      segment: {
        id: 'segment-low-tail',
        membershipId: 'membership-low',
        purchaseOrderId: 'purchase-low-renewal',
      } as MembershipEntitlementSegment,
      grant: {
        purchaseOrderId: 'purchase-low-renewal',
        grantedCents: 60_000,
        remainingCents: 60_000,
      } as MemberCreditGrant,
      account: {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: 'membership-high',
        availableCreditCents: 120_000,
      } as MemberAccount,
      activeMembership: {
        id: 'membership-low',
        userId: 'user-1',
        status: MembershipStatus.REPLACED,
      } as UserMembership,
    });

    await expect(
      service.voidPurchase('purchase-low-renewal', 'admin-1'),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
      });
      return true;
    });
    expect(credit.reverseUnusedMembershipPurchaseGrant).not.toHaveBeenCalled();
    expect(entitlement.restoreVoidedPurchase).not.toHaveBeenCalled();
  });

  it('locks every target and previous membership in ID order before reversing credit', async () => {
    const purchase = {
      id: 'purchase-1',
      userId: 'user-1',
      membershipLevelId: 'level-gold',
      purchaseNo: 'MP202607210001',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      priceCents: 50_000,
      grantCreditCents: 60_000,
      discountBasisPoints: 9_500,
      validDays: 365,
      benefits: [],
      theme: MembershipTheme.CHAMPAGNE,
      badgeText: 'GOLD',
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
      paidAt: now,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    } as unknown as MembershipPurchaseOrder;
    const target = {
      id: 'membership-20',
      userId: 'user-1',
      previousMembershipId: 'membership-10',
      status: MembershipStatus.ACTIVE,
      startsAt: now,
      endsAt: new Date('2027-07-21T08:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    } as UserMembership;
    const previous = {
      id: 'membership-10',
      userId: 'user-1',
      previousMembershipId: null,
      status: MembershipStatus.REPLACED,
      startsAt: new Date('2026-01-01T08:00:00.000Z'),
      endsAt: new Date('2026-12-31T08:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    } as UserMembership;
    const segment = {
      id: 'segment-1',
      membershipId: target.id,
      purchaseOrderId: purchase.id,
      kind: MembershipEntitlementSegmentKind.UPGRADE,
      startsAt: now,
      endsAt: new Date('2027-07-21T08:00:00.000Z'),
      previousMembershipId: previous.id,
      previousMembershipEndsAt: new Date('2026-12-31T08:00:00.000Z'),
      createdAt: now,
    } as MembershipEntitlementSegment;
    const events: string[] = [];
    const { service, membershipRepository, credit, entitlement } = buildService(
      {
        purchase,
        activeMembership: target,
        previousMembership: previous,
        segment,
        grant: {
          id: 'grant-1',
          accountId: 'account-1',
          purchaseOrderId: purchase.id,
          grantedCents: 60_000,
          remainingCents: 60_000,
          status: MemberCreditGrantStatus.ACTIVE,
          createdAt: now,
          updatedAt: now,
        } as MemberCreditGrant,
        account: {
          id: 'account-1',
          userId: 'user-1',
          activeMembershipId: target.id,
          availableCreditCents: 60_000,
        } as MemberAccount,
      },
    );
    membershipRepository.findOne.mockImplementation(
      async (
        input: { where?: Record<string, unknown>; lock?: unknown } = {},
      ) => {
        const id = input.where?.id;
        if (input.lock) events.push(`membership:${String(id)}`);
        return id === previous.id ? previous : id === target.id ? target : null;
      },
    );
    credit.reverseUnusedMembershipPurchaseGrant.mockImplementationOnce(
      async (_manager, lockedAccount) => {
        events.push('credit');
        return { account: lockedAccount, entry: null, allocations: [] };
      },
    );

    await service.voidPurchase(purchase.id, 'admin-1');

    expect(events).toEqual([
      `membership:${previous.id}`,
      `membership:${target.id}`,
      'credit',
    ]);
    expect(entitlement.restoreVoidedPurchase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetMembership: target,
        previousMembership: previous,
      }),
    );
  });

  it('voids an unused current purchase by delegating credit reversal and membership restore, then marks the purchase voided', async () => {
    const purchase = {
      id: 'purchase-1',
      userId: 'user-1',
      membershipLevelId: 'level-gold',
      purchaseNo: 'MP202607210001',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      priceCents: 50_000,
      grantCreditCents: 60_000,
      discountBasisPoints: 9_500,
      validDays: 365,
      benefits: [{ title: '全场九五折', sortOrder: 10 }],
      theme: MembershipTheme.CHAMPAGNE,
      badgeText: 'GOLD',
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
      paidAt: now,
      createdAt: now,
      updatedAt: now,
    } as unknown as MembershipPurchaseOrder;
    const currentMembership = {
      id: 'membership-current',
      userId: 'user-1',
      purchaseOrderId: 'purchase-1',
      membershipLevelId: 'level-gold',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      discountBasisPoints: 9_500,
      benefits: [],
      theme: MembershipTheme.CHAMPAGNE,
      badgeText: 'GOLD',
      startsAt: now,
      endsAt: new Date('2027-07-21T08:00:00.000Z'),
      previousMembershipId: 'membership-previous',
      status: MembershipStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    } as unknown as UserMembership;
    const previousMembership = {
      id: 'membership-previous',
      userId: 'user-1',
      purchaseOrderId: 'purchase-old',
      membershipLevelId: 'level-silver',
      levelCode: 'SILVER',
      levelName: '银卡',
      levelRank: 10,
      discountBasisPoints: 5_000,
      benefits: [],
      theme: MembershipTheme.PEARL,
      badgeText: 'SILVER',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-31T08:00:00.000Z'),
      previousMembershipId: null,
      status: MembershipStatus.REPLACED,
      createdAt: now,
      updatedAt: now,
    } as unknown as UserMembership;
    const segment = {
      id: 'segment-1',
      membershipId: 'membership-current',
      purchaseOrderId: 'purchase-1',
      kind: MembershipEntitlementSegmentKind.UPGRADE,
      startsAt: now,
      endsAt: new Date('2027-07-21T08:00:00.000Z'),
      previousMembershipId: 'membership-previous',
      previousMembershipEndsAt: new Date('2026-12-31T08:00:00.000Z'),
      createdAt: now,
    } as MembershipEntitlementSegment;
    const inputAccount = {
      id: 'account-1',
      userId: 'user-1',
      activeMembershipId: 'membership-current',
      availableCreditCents: 60_000,
    } as MemberAccount;
    const { service, savedPurchases, entitlement, credit } = buildService({
      purchase,
      activeMembership: currentMembership,
      previousMembership,
      segment,
      grant: {
        id: 'grant-1',
        accountId: 'account-1',
        purchaseOrderId: 'purchase-1',
        grantedCents: 60_000,
        remainingCents: 60_000,
        status: MemberCreditGrantStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
      } as MemberCreditGrant,
      account: inputAccount,
    });
    credit.reverseUnusedMembershipPurchaseGrant.mockResolvedValueOnce({
      account: { ...inputAccount, availableCreditCents: 0 },
      entry: null,
      allocations: [],
    });
    entitlement.restoreVoidedPurchase.mockResolvedValueOnce({
      account: { ...inputAccount, availableCreditCents: 0 },
      membership: previousMembership,
      voidedMembership: currentMembership,
    });

    const result = await service.voidPurchase('purchase-1', 'admin-1');

    expect(result).toMatchObject({
      purchase: {
        id: 'purchase-1',
        status: MembershipPurchaseStatus.VOIDED,
        paymentStatus: MembershipPaymentStatus.REVERSED,
        membershipId: 'membership-current',
      },
    });
    // Credit reversal is delegated with the locked account and purchase.
    expect(credit.reverseUnusedMembershipPurchaseGrant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'account-1' }),
      expect.objectContaining({ id: 'purchase-1' }),
    );
    // Restore is delegated with the post-reversal account, the purchase, and
    // the segment located for this purchase.
    expect(entitlement.restoreVoidedPurchase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        purchase: expect.objectContaining({ id: 'purchase-1' }),
        segment: expect.objectContaining({ id: 'segment-1' }),
      }),
    );
    expect(savedPurchases.at(-1)).toMatchObject({
      status: MembershipPurchaseStatus.VOIDED,
      paymentStatus: MembershipPaymentStatus.REVERSED,
    });
  });

  it('refuses to void a purchase whose granted credit was used', async () => {
    const { service, credit } = buildService({
      purchase: {
        id: 'purchase-1',
        userId: 'user-1',
        status: MembershipPurchaseStatus.FULFILLED,
        paymentStatus: MembershipPaymentStatus.SUCCEEDED,
        grantCreditCents: 60_000,
      } as MembershipPurchaseOrder,
      segment: {
        id: 'segment-1',
        membershipId: 'membership-current',
        purchaseOrderId: 'purchase-1',
      } as MembershipEntitlementSegment,
      grant: {
        purchaseOrderId: 'purchase-1',
        grantedCents: 60_000,
        remainingCents: 10_000,
      } as MemberCreditGrant,
      account: {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: 'membership-current',
        availableCreditCents: 60_000,
      } as MemberAccount,
      activeMembership: {
        id: 'membership-current',
        purchaseOrderId: 'purchase-1',
      } as unknown as UserMembership,
    });
    // Credit reversal refuses when the grant has been partially used; this is
    // now delegated to MembershipCreditService, which throws purchaseNotVoidable.
    credit.reverseUnusedMembershipPurchaseGrant.mockRejectedValueOnce(
      new ConflictException({
        code: ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
        message: '赠送消费金已被使用',
      }),
    );

    await expect(
      service.voidPurchase('purchase-1', 'admin-1'),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
      });
      return true;
    });
  });

  it('returns the active membership, available credit, and only purchasable levels to the customer', async () => {
    const activeMembership = {
      id: 'membership-1',
      membershipLevelId: 'level-gold',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      discountBasisPoints: 9_500,
      benefits: [{ title: '全场九五折', sortOrder: 10 }],
      theme: MembershipTheme.CHAMPAGNE,
      badgeText: 'GOLD',
      status: MembershipStatus.ACTIVE,
      startsAt: new Date('2026-07-01T00:00:00.000Z'),
      endsAt: new Date('2027-07-01T00:00:00.000Z'),
    } as unknown as UserMembership;
    const { service } = buildService({
      activeMembership,
      account: {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: 'membership-1',
        availableCreditCents: 12_345,
        version: 2,
      } as MemberAccount,
    });

    await expect(service.getOverview('user-1')).resolves.toMatchObject({
      currentMembership: { id: 'membership-1', code: 'GOLD' },
      account: { availableCreditCents: 12_345, version: 2 },
      levels: [expect.objectContaining({ id: 'level-gold' })],
      simulatedPaymentEnabled: true,
    });
  });

  it('creates a pending purchase with an immutable level snapshot only', async () => {
    const { service, savedPurchases, savedMemberships, savedGrants } =
      buildService();

    await expect(
      service.createPurchase('user-1', 'purchase-key-1', {
        levelId: 'level-gold',
      }),
    ).resolves.toMatchObject({
      status: MembershipPurchaseStatus.PENDING,
      paymentStatus: MembershipPaymentStatus.PENDING,
      levelCode: 'GOLD',
      grantCreditCents: 60_000,
    });
    expect(savedPurchases).toHaveLength(1);
    expect(savedMemberships).toHaveLength(0);
    expect(savedGrants).toHaveLength(0);
  });

  it('refuses payment when the originally selected level was later deactivated', async () => {
    const pendingPurchase = {
      ...activeLevel(),
      id: 'purchase-1',
      userId: 'user-1',
      membershipLevelId: 'level-gold',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      status: MembershipPurchaseStatus.PENDING,
      paymentStatus: MembershipPaymentStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    } as unknown as MembershipPurchaseOrder;
    const { service } = buildService({
      purchase: pendingPurchase,
      level: activeLevel({ isActive: false }),
    });

    await expect(
      service.simulatePayment('user-1', 'purchase-1', 'payment-key-1'),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBERSHIP_LEVEL_INACTIVE,
      });
      return true;
    });
  });

  it('returns the membership identified by its segment when a fulfilled purchase retries under a different payment key', async () => {
    const fulfilledPurchase = {
      ...activeLevel(),
      id: 'purchase-1',
      userId: 'user-1',
      membershipLevelId: 'level-gold',
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
      paidAt: now,
      createdAt: now,
      updatedAt: now,
    } as unknown as MembershipPurchaseOrder;
    const { service } = buildService({
      purchase: fulfilledPurchase,
      segment: {
        purchaseOrderId: 'purchase-1',
        membershipId: 'membership-original',
      } as MembershipEntitlementSegment,
      account: {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: 'membership-current',
        availableCreditCents: 0,
      } as MemberAccount,
    });

    await expect(
      service.simulatePayment('user-1', 'purchase-1', 'retry-key-2'),
    ).resolves.toMatchObject({
      membershipId: 'membership-original',
      status: MembershipPurchaseStatus.FULFILLED,
    });
  });

  it('does not fulfil a pending purchase or grant credit when entitlement application fails', async () => {
    const pendingPurchase = {
      ...activeLevel(),
      id: 'purchase-1',
      userId: 'user-1',
      membershipLevelId: 'level-gold',
      status: MembershipPurchaseStatus.PENDING,
      paymentStatus: MembershipPaymentStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    } as unknown as MembershipPurchaseOrder;
    const { service, entitlement, credit, savedPurchases } = buildService({
      purchase: pendingPurchase,
      account: {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: null,
        availableCreditCents: 0,
      } as MemberAccount,
    });
    entitlement.applyPaidPurchase.mockRejectedValueOnce(
      new Error('segment write failed'),
    );

    await expect(
      service.simulatePayment('user-1', 'purchase-1', 'payment-key-1'),
    ).rejects.toThrow('segment write failed');
    expect(credit.grantMembershipPurchase).not.toHaveBeenCalled();
    expect(savedPurchases).toEqual([]);
  });

  it('fulfills a zero-credit level without creating an invalid zero ledger entry', async () => {
    const pendingPurchase = {
      ...activeLevel({ grantCreditCents: 0 }),
      id: 'purchase-1',
      userId: 'user-1',
      membershipLevelId: 'level-gold',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      status: MembershipPurchaseStatus.PENDING,
      paymentStatus: MembershipPaymentStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    } as unknown as MembershipPurchaseOrder;
    const { service, savedEntries, savedGrants } = buildService({
      purchase: pendingPurchase,
      level: activeLevel({ grantCreditCents: 0 }),
    });

    await service.simulatePayment('user-1', 'purchase-1', 'payment-key-1');

    expect(savedEntries).toHaveLength(0);
    expect(savedGrants).toHaveLength(0);
  });

  it('fulfills simulated payment by creating the membership and permanent credit ledger', async () => {
    const pendingPurchase = {
      ...activeLevel(),
      id: 'purchase-1',
      userId: 'user-1',
      membershipLevelId: 'level-gold',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      status: MembershipPurchaseStatus.PENDING,
      paymentStatus: MembershipPaymentStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    } as unknown as MembershipPurchaseOrder;
    const { service, savedPurchases, credit } = buildService({
      purchase: pendingPurchase,
    });

    await expect(
      service.simulatePayment('user-1', 'purchase-1', 'payment-key-1'),
    ).resolves.toMatchObject({
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
      membershipId: 'membership-1',
    });
    expect(credit.lockOrCreateAccount).toHaveBeenCalledTimes(1);
    expect(credit.grantMembershipPurchase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'account-1' }),
      expect.objectContaining({ id: 'purchase-1' }),
    );
    expect(savedPurchases.at(-1)).toMatchObject({
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
    });
  });

  it('rejects simulated payments when the explicit environment switch is disabled', async () => {
    const { service } = buildService({ simulatedPaymentEnabled: false });

    await expect(
      service.simulatePayment('user-1', 'purchase-1', 'payment-key-1'),
    ).rejects.toSatisfy((error: ForbiddenException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.SIMULATED_PAYMENT_DISABLED,
      });
      return true;
    });
  });

  it('rejects simulated payments in production even when its configuration switch is enabled', async () => {
    const { service } = buildService({ simulatedPaymentEnabled: true });
    (service as unknown as { config: { get: () => unknown } }).config = {
      get: () => ({ NODE_ENV: 'production', SIMULATED_PAYMENT_ENABLED: true }),
    };

    await expect(
      service.simulatePayment('user-1', 'purchase-1', 'payment-key-1'),
    ).rejects.toSatisfy((error: ForbiddenException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.SIMULATED_PAYMENT_DISABLED,
      });
      return true;
    });
  });

  it('delegates same-rank payment to the entitlement state machine without creating another membership', async () => {
    const pendingPurchase = {
      ...activeLevel({ validDays: 30 }),
      id: 'purchase-1',
      userId: 'user-1',
      membershipLevelId: 'level-gold',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      status: MembershipPurchaseStatus.PENDING,
      paymentStatus: MembershipPaymentStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    } as unknown as MembershipPurchaseOrder;
    const activeMembership = {
      id: 'membership-old',
      levelRank: 20,
      levelName: '旧快照金卡',
      status: MembershipStatus.ACTIVE,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-31T08:00:00.000Z'),
    } as unknown as UserMembership;
    const { service, entitlement } = buildService({
      purchase: pendingPurchase,
      activeMembership,
      account: {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: 'membership-old',
        availableCreditCents: 0,
      } as MemberAccount,
    });

    await service.simulatePayment('user-1', 'purchase-1', 'payment-key-1');

    expect(entitlement.applyPaidPurchase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        account: expect.objectContaining({
          activeMembershipId: 'membership-old',
        }),
        purchase: expect.objectContaining({ validDays: 30 }),
        now,
      }),
    );
  });

  it('rejects a downgrade while a higher membership remains valid', async () => {
    const pendingPurchase = {
      ...activeLevel({ rank: 20 }),
      id: 'purchase-1',
      userId: 'user-1',
      membershipLevelId: 'level-gold',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      status: MembershipPurchaseStatus.PENDING,
      paymentStatus: MembershipPaymentStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    } as unknown as MembershipPurchaseOrder;
    const activeMembership = {
      id: 'membership-vip',
      levelRank: 30,
      status: MembershipStatus.ACTIVE,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2027-01-01T00:00:00.000Z'),
    } as unknown as UserMembership;
    const { service, entitlement } = buildService({
      purchase: pendingPurchase,
      activeMembership,
      account: {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: 'membership-vip',
        availableCreditCents: 0,
      } as MemberAccount,
    });

    entitlement.applyPaidPurchase.mockRejectedValueOnce(
      new ConflictException({
        code: ApiErrorCode.MEMBERSHIP_DOWNGRADE_NOT_ALLOWED,
        message: '当前会员有效期内不可购买更低等级',
      }),
    );

    await expect(
      service.simulatePayment('user-1', 'purchase-1', 'payment-key-1'),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBERSHIP_DOWNGRADE_NOT_ALLOWED,
      });
      return true;
    });
  });
});
