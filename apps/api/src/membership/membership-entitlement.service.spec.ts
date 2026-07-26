import { ConflictException } from '@nestjs/common';
import {
  ApiErrorCode,
  MembershipEntitlementSegmentKind,
  MembershipStatus,
  MembershipTheme,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { MemberAccount } from '../database/entities/member-account.entity.js';
import { MembershipEntitlementSegment } from '../database/entities/membership-entitlement-segment.entity.js';
import { MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';
import { MembershipEntitlementService } from './membership-entitlement.service.js';

const now = new Date('2026-07-23T08:00:00.000Z');

const purchase = (overrides: Partial<MembershipPurchaseOrder> = {}) =>
  ({
    id: 'purchase-1',
    userId: 'user-1',
    membershipLevelId: 'level-gold',
    levelCode: 'GOLD',
    levelName: '鎏金会员',
    levelRank: 20,
    discountBasisPoints: 9_500,
    benefits: [{ title: '全场九五折', sortOrder: 10 }],
    theme: MembershipTheme.CHAMPAGNE,
    badgeText: 'GOLD',
    validDays: 365,
    ...overrides,
  }) as MembershipPurchaseOrder;

const account = (overrides: Partial<MemberAccount> = {}) =>
  ({
    id: 'account-1',
    userId: 'user-1',
    activeMembershipId: null,
    availableCreditCents: 0,
    ...overrides,
  }) as MemberAccount;

const membership = (overrides: Partial<UserMembership> = {}) =>
  ({
    id: 'membership-1',
    userId: 'user-1',
    purchaseOrderId: 'purchase-old',
    membershipLevelId: 'level-gold',
    levelCode: 'GOLD',
    levelName: '旧金卡',
    levelRank: 20,
    discountBasisPoints: 9_500,
    benefits: [{ title: '旧权益', sortOrder: 10 }],
    theme: MembershipTheme.CHAMPAGNE,
    badgeText: 'OLD',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: new Date('2026-12-31T08:00:00.000Z'),
    previousMembershipId: null,
    status: MembershipStatus.ACTIVE,
    ...overrides,
  }) as UserMembership;

const buildService = ({
  current = null,
  tail = null,
  previousMembership = null,
}: {
  current?: UserMembership | null;
  tail?: MembershipEntitlementSegment | null;
  previousMembership?: UserMembership | null;
} = {}) => {
  const savedMemberships: UserMembership[] = [];
  const savedSegments: MembershipEntitlementSegment[] = [];
  const savedAccounts: MemberAccount[] = [];
  const memberships = {
    findOne: vi.fn(async (input: { where?: { id?: string } }) => {
      const id = input?.where?.id;
      if (id && current?.id === id) return current;
      if (id && previousMembership?.id === id) return previousMembership;
      if (id) return null;
      return current;
    }),
    create: vi.fn((value: UserMembership) => value),
    save: vi.fn(async (value: UserMembership) => {
      const saved = {
        ...value,
        id: value.id ?? `membership-${savedMemberships.length + 1}`,
      };
      savedMemberships.push(saved);
      return saved;
    }),
  };
  const segments = {
    findOne: vi.fn().mockResolvedValue(tail),
    create: vi.fn((value: MembershipEntitlementSegment) => value),
    save: vi.fn(async (value: MembershipEntitlementSegment) => {
      const saved = {
        ...value,
        id: value.id ?? `segment-${savedSegments.length + 1}`,
      };
      savedSegments.push(saved);
      return saved;
    }),
  };
  const accounts = {
    save: vi.fn(async (value: MemberAccount) => {
      savedAccounts.push(value);
      return value;
    }),
  };
  const repositories = new Map<unknown, object>([
    [UserMembership, memberships],
    [MembershipEntitlementSegment, segments],
    [MemberAccount, accounts],
  ]);
  return {
    service: new MembershipEntitlementService(),
    manager: {
      getRepository: vi.fn((entity: unknown) => repositories.get(entity)),
    },
    savedMemberships,
    savedSegments,
    savedAccounts,
  };
};

describe('MembershipEntitlementService', () => {
  it('creates an initial membership and segment for a first paid purchase', async () => {
    const { service, manager, savedMemberships, savedSegments, savedAccounts } =
      buildService();

    const result = await service.applyPaidPurchase(manager as never, {
      account: account(),
      purchase: purchase(),
      now,
    });

    expect(result).toMatchObject({
      kind: MembershipEntitlementSegmentKind.INITIAL,
    });
    expect(savedMemberships).toEqual([
      expect.objectContaining({
        status: MembershipStatus.ACTIVE,
        startsAt: now,
        endsAt: new Date('2027-07-23T08:00:00.000Z'),
      }),
    ]);
    expect(savedSegments).toEqual([
      expect.objectContaining({
        kind: MembershipEntitlementSegmentKind.INITIAL,
        startsAt: now,
        endsAt: new Date('2027-07-23T08:00:00.000Z'),
        previousMembershipId: null,
      }),
    ]);
    expect(savedAccounts).toEqual([
      expect.objectContaining({ activeMembershipId: 'membership-1' }),
    ]);
  });

  it('extends the active membership with a renewal segment without replacing its snapshot', async () => {
    const current = membership();
    const { service, manager, savedMemberships, savedSegments, savedAccounts } =
      buildService({
        current,
        tail: {
          membershipId: current.id,
          endsAt: current.endsAt,
        } as MembershipEntitlementSegment,
      });

    const result = await service.applyPaidPurchase(manager as never, {
      account: account({ activeMembershipId: current.id }),
      purchase: purchase({
        validDays: 30,
        benefits: [{ title: '新权益', sortOrder: 10 }],
      }),
      now,
    });

    expect(result).toMatchObject({
      kind: MembershipEntitlementSegmentKind.RENEWAL,
      membership: { id: current.id, levelName: '旧金卡', badgeText: 'OLD' },
    });
    expect(savedMemberships).toEqual([
      expect.objectContaining({
        id: current.id,
        endsAt: new Date('2027-01-30T08:00:00.000Z'),
        levelName: '旧金卡',
        benefits: [{ title: '旧权益', sortOrder: 10 }],
      }),
    ]);
    expect(savedSegments).toEqual([
      expect.objectContaining({
        membershipId: current.id,
        kind: MembershipEntitlementSegmentKind.RENEWAL,
        startsAt: current.endsAt,
        endsAt: new Date('2027-01-30T08:00:00.000Z'),
      }),
    ]);
    expect(savedAccounts).toEqual([]);
  });

  it('rejects a renewal whose locked chain tail does not end at the membership expiry', async () => {
    const current = membership();
    const { service, manager } = buildService({
      current,
      tail: {
        membershipId: current.id,
        endsAt: new Date('2026-12-30T08:00:00.000Z'),
      } as MembershipEntitlementSegment,
    });

    await expect(
      service.applyPaidPurchase(manager as never, {
        account: account({ activeMembershipId: current.id }),
        purchase: purchase(),
        now,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('expires an old membership and creates a new initial membership after expiry', async () => {
    const expired = membership({
      endsAt: new Date('2026-07-22T08:00:00.000Z'),
    });
    const { service, manager, savedMemberships, savedSegments } = buildService({
      current: expired,
    });

    await service.applyPaidPurchase(manager as never, {
      account: account({ activeMembershipId: expired.id }),
      purchase: purchase(),
      now,
    });

    expect(savedMemberships).toEqual([
      expect.objectContaining({
        id: expired.id,
        status: MembershipStatus.EXPIRED,
      }),
      expect.objectContaining({
        id: 'membership-2',
        status: MembershipStatus.ACTIVE,
        startsAt: now,
      }),
    ]);
    expect(savedSegments.at(-1)).toMatchObject({
      kind: MembershipEntitlementSegmentKind.INITIAL,
      membershipId: 'membership-2',
    });
  });

  it('immediately upgrades, preserves the old expiry in its segment, and discards future old time', async () => {
    const current = membership({
      levelRank: 20,
      endsAt: new Date('2027-12-31T08:00:00.000Z'),
    });
    const { service, manager, savedMemberships, savedSegments, savedAccounts } =
      buildService({ current });

    await service.applyPaidPurchase(manager as never, {
      account: account({ activeMembershipId: current.id }),
      purchase: purchase({
        levelRank: 30,
        levelCode: 'VIP',
        levelName: '黑金会员',
      }),
      now,
    });

    expect(savedMemberships).toEqual([
      expect.objectContaining({
        id: current.id,
        status: MembershipStatus.REPLACED,
        endsAt: now,
      }),
      expect.objectContaining({
        id: 'membership-2',
        levelCode: 'VIP',
        startsAt: now,
      }),
    ]);
    expect(savedSegments).toEqual([
      expect.objectContaining({
        kind: MembershipEntitlementSegmentKind.UPGRADE,
        previousMembershipId: current.id,
        previousMembershipEndsAt: new Date('2027-12-31T08:00:00.000Z'),
      }),
    ]);
    expect(savedAccounts).toEqual([
      expect.objectContaining({ activeMembershipId: 'membership-2' }),
    ]);
  });

  it('rejects a lower rank while the current membership remains valid', async () => {
    const { service, manager } = buildService({
      current: membership({ levelRank: 30 }),
    });

    await expect(
      service.applyPaidPurchase(manager as never, {
        account: account({ activeMembershipId: 'membership-1' }),
        purchase: purchase({ levelRank: 20 }),
        now,
      }),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBERSHIP_DOWNGRADE_NOT_ALLOWED,
      });
      return true;
    });
  });

  describe('restoreVoidedPurchase', () => {
    const renewalSegment = (
      overrides: Partial<MembershipEntitlementSegment> = {},
    ) =>
      ({
        id: 'segment-renewal',
        membershipId: 'membership-1',
        purchaseOrderId: 'purchase-1',
        kind: MembershipEntitlementSegmentKind.RENEWAL,
        startsAt: new Date('2026-07-23T08:00:00.000Z'),
        endsAt: new Date('2026-08-22T08:00:00.000Z'),
        previousMembershipId: null,
        previousMembershipEndsAt: null,
        ...overrides,
      }) as MembershipEntitlementSegment;

    it('rolls back a RENEWAL segment by shortening the same membership endsAt', async () => {
      const renewed = membership({
        id: 'membership-1',
        purchaseOrderId: 'purchase-old',
        startsAt: new Date('2026-06-23T08:00:00.000Z'),
        endsAt: new Date('2026-08-22T08:00:00.000Z'),
        status: MembershipStatus.ACTIVE,
      });
      const segment = renewalSegment({
        startsAt: new Date('2026-07-23T08:00:00.000Z'),
        endsAt: new Date('2026-08-22T08:00:00.000Z'),
      });
      const inputAccount = account({ activeMembershipId: 'membership-1' });
      const { service, manager, savedMemberships, savedAccounts } =
        buildService({ current: renewed, previousMembership: null });

      const result = await service.restoreVoidedPurchase(manager as never, {
        account: inputAccount,
        purchase: purchase({ id: 'purchase-1' }),
        segment,
        targetMembership: renewed,
        previousMembership: null,
        now: new Date('2026-06-15T08:00:00.000Z'),
      });

      expect(result.membership.id).toBe('membership-1');
      expect(savedMemberships.at(-1)).toMatchObject({
        id: 'membership-1',
        endsAt: new Date('2026-07-23T08:00:00.000Z'),
        status: MembershipStatus.ACTIVE,
      });
      // account 指针保持指向同一会员,余额由 credit service 另行冲正
      expect(savedAccounts.at(-1)).toMatchObject({
        activeMembershipId: 'membership-1',
      });
    });

    it('expires the membership and clears the account pointer when a RENEWAL rollback lands in the past', async () => {
      const renewed = membership({
        id: 'membership-1',
        startsAt: new Date('2026-06-23T08:00:00.000Z'),
        endsAt: new Date('2026-06-24T08:00:00.000Z'),
        status: MembershipStatus.ACTIVE,
      });
      const segment = renewalSegment({
        startsAt: new Date('2026-06-23T08:00:00.000Z'),
        endsAt: new Date('2026-06-24T08:00:00.000Z'),
      });
      const inputAccount = account({ activeMembershipId: 'membership-1' });
      const { service, manager, savedMemberships, savedAccounts } =
        buildService({ current: renewed });

      await service.restoreVoidedPurchase(manager as never, {
        account: inputAccount,
        purchase: purchase({ id: 'purchase-1' }),
        segment,
        targetMembership: renewed,
        previousMembership: null,
        now: new Date('2026-07-23T08:00:00.000Z'),
      });

      expect(savedMemberships.at(-1)).toMatchObject({
        id: 'membership-1',
        endsAt: new Date('2026-06-23T08:00:00.000Z'),
        status: MembershipStatus.EXPIRED,
      });
      expect(savedAccounts.at(-1)).toMatchObject({
        activeMembershipId: null,
      });
    });

    it('restores the previous membership original endsAt and reactivates it on UPGRADE void', async () => {
      const previous = membership({
        id: 'membership-prev',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2026-09-01T00:00:00.000Z'),
        status: MembershipStatus.REPLACED,
      });
      const upgraded = membership({
        id: 'membership-2',
        previousMembershipId: 'membership-prev',
        startsAt: new Date('2026-07-23T08:00:00.000Z'),
        endsAt: new Date('2027-07-23T08:00:00.000Z'),
        status: MembershipStatus.ACTIVE,
      });
      const segment = {
        id: 'segment-upgrade',
        membershipId: 'membership-2',
        purchaseOrderId: 'purchase-1',
        kind: MembershipEntitlementSegmentKind.UPGRADE,
        startsAt: new Date('2026-07-23T08:00:00.000Z'),
        endsAt: new Date('2027-07-23T08:00:00.000Z'),
        previousMembershipId: 'membership-prev',
        previousMembershipEndsAt: new Date('2026-09-01T00:00:00.000Z'),
      } as MembershipEntitlementSegment;
      const inputAccount = account({ activeMembershipId: 'membership-2' });
      const { service, manager, savedMemberships, savedAccounts } =
        buildService({ current: upgraded, previousMembership: previous });

      const result = await service.restoreVoidedPurchase(manager as never, {
        account: inputAccount,
        purchase: purchase({ id: 'purchase-1' }),
        segment,
        targetMembership: upgraded,
        previousMembership: previous,
        now,
      });

      expect(result.membership.id).toBe('membership-prev');
      expect(savedMemberships).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'membership-2',
            status: MembershipStatus.VOIDED,
          }),
          expect.objectContaining({
            id: 'membership-prev',
            endsAt: new Date('2026-09-01T00:00:00.000Z'),
            status: MembershipStatus.ACTIVE,
          }),
        ]),
      );
      expect(savedAccounts.at(-1)).toMatchObject({
        activeMembershipId: 'membership-prev',
      });
    });

    it('expires the previous membership instead of reactivating when an UPGRADE rollback lands past its original expiry', async () => {
      const previous = membership({
        id: 'membership-prev',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2026-02-01T00:00:00.000Z'),
        status: MembershipStatus.REPLACED,
      });
      const upgraded = membership({
        id: 'membership-2',
        previousMembershipId: 'membership-prev',
        startsAt: new Date('2026-03-01T00:00:00.000Z'),
        endsAt: new Date('2027-03-01T00:00:00.000Z'),
        status: MembershipStatus.ACTIVE,
      });
      const segment = {
        id: 'segment-upgrade',
        membershipId: 'membership-2',
        purchaseOrderId: 'purchase-1',
        kind: MembershipEntitlementSegmentKind.UPGRADE,
        startsAt: new Date('2026-03-01T00:00:00.000Z'),
        endsAt: new Date('2027-03-01T00:00:00.000Z'),
        previousMembershipId: 'membership-prev',
        previousMembershipEndsAt: new Date('2026-02-01T00:00:00.000Z'),
      } as MembershipEntitlementSegment;
      const { service, manager, savedMemberships, savedAccounts } =
        buildService({ current: upgraded, previousMembership: previous });

      await service.restoreVoidedPurchase(manager as never, {
        account: account({ activeMembershipId: 'membership-2' }),
        purchase: purchase({ id: 'purchase-1' }),
        segment,
        targetMembership: upgraded,
        previousMembership: previous,
        now: new Date('2026-07-23T08:00:00.000Z'),
      });

      expect(savedMemberships).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'membership-2',
            status: MembershipStatus.VOIDED,
          }),
          expect.objectContaining({
            id: 'membership-prev',
            endsAt: new Date('2026-02-01T00:00:00.000Z'),
            status: MembershipStatus.EXPIRED,
          }),
        ]),
      );
      expect(savedAccounts.at(-1)).toMatchObject({
        activeMembershipId: null,
      });
    });

    it('voids an INITIAL membership and only restores a still-valid previous membership', async () => {
      const initial = membership({
        id: 'membership-1',
        previousMembershipId: 'membership-prev',
        startsAt: new Date('2026-07-23T08:00:00.000Z'),
        endsAt: new Date('2027-07-23T08:00:00.000Z'),
        status: MembershipStatus.ACTIVE,
      });
      const segment = {
        id: 'segment-initial',
        membershipId: 'membership-1',
        purchaseOrderId: 'purchase-1',
        kind: MembershipEntitlementSegmentKind.INITIAL,
        startsAt: new Date('2026-07-23T08:00:00.000Z'),
        endsAt: new Date('2027-07-23T08:00:00.000Z'),
        previousMembershipId: null,
        previousMembershipEndsAt: null,
      } as MembershipEntitlementSegment;
      // INITIAL segment 没有记录 previous,但 membership 上的 previousMembershipId
      // 指向作废时仍需尝试恢复的前一会员(若仍有效)。
      const previousStillValid = membership({
        id: 'membership-prev',
        endsAt: new Date('2026-12-31T08:00:00.000Z'),
        status: MembershipStatus.REPLACED,
      });
      const { service, manager, savedMemberships, savedAccounts } =
        buildService({
          current: initial,
          previousMembership: previousStillValid,
        });

      const result = await service.restoreVoidedPurchase(manager as never, {
        account: account({ activeMembershipId: 'membership-1' }),
        purchase: purchase({ id: 'purchase-1' }),
        segment,
        targetMembership: initial,
        previousMembership: previousStillValid,
        now,
      });

      expect(result.membership.id).toBe('membership-prev');
      expect(savedMemberships).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'membership-1',
            status: MembershipStatus.VOIDED,
          }),
          expect.objectContaining({
            id: 'membership-prev',
            status: MembershipStatus.ACTIVE,
          }),
        ]),
      );
      expect(savedAccounts.at(-1)).toMatchObject({
        activeMembershipId: 'membership-prev',
      });
    });

    it('voids an INITIAL membership and clears the pointer when no previous membership remains valid', async () => {
      const initial = membership({
        id: 'membership-1',
        previousMembershipId: 'membership-prev',
        startsAt: new Date('2026-07-23T08:00:00.000Z'),
        endsAt: new Date('2027-07-23T08:00:00.000Z'),
        status: MembershipStatus.ACTIVE,
      });
      const segment = {
        id: 'segment-initial',
        membershipId: 'membership-1',
        purchaseOrderId: 'purchase-1',
        kind: MembershipEntitlementSegmentKind.INITIAL,
        startsAt: new Date('2026-07-23T08:00:00.000Z'),
        endsAt: new Date('2027-07-23T08:00:00.000Z'),
        previousMembershipId: null,
        previousMembershipEndsAt: null,
      } as MembershipEntitlementSegment;
      const { service, manager, savedMemberships, savedAccounts } =
        buildService({ current: initial, previousMembership: null });

      await service.restoreVoidedPurchase(manager as never, {
        account: account({ activeMembershipId: 'membership-1' }),
        purchase: purchase({ id: 'purchase-1' }),
        segment,
        targetMembership: initial,
        previousMembership: null,
        now,
      });

      expect(savedMemberships.at(-1)).toMatchObject({
        id: 'membership-1',
        status: MembershipStatus.VOIDED,
      });
      expect(savedAccounts.at(-1)).toMatchObject({
        activeMembershipId: null,
      });
    });
  });
});
