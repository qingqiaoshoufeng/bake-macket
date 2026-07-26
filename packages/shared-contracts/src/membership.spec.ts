import { describe, expect, it } from 'vitest';

import { ApiErrorCode } from './enums.js';
import {
  MemberCreditDirection,
  MemberCreditGrantStatus,
  MembershipEntitlementSegmentKind,
  MembershipPaymentChannel,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipPurchaseVoidReasonCode,
  MembershipStatus,
  MembershipTheme,
  type AdminMembershipPurchaseDetailView,
} from './membership.js';

describe('membership contracts', () => {
  it('exposes stable states for cards, purchases, payments, and credit entries', () => {
    expect(MembershipTheme.CHAMPAGNE).toBe('CHAMPAGNE');
    expect(MembershipStatus.ACTIVE).toBe('ACTIVE');
    expect(MembershipPurchaseStatus.FULFILLED).toBe('FULFILLED');
    expect(MembershipPaymentStatus.SUCCEEDED).toBe('SUCCEEDED');
    expect(MemberCreditDirection.DEBIT).toBe('DEBIT');
    expect(ApiErrorCode.MEMBERSHIP_LEVEL_CONFLICT).toBe(
      'MEMBERSHIP_LEVEL_CONFLICT',
    );
    expect(ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_FOUND).toBe(
      'MEMBERSHIP_PURCHASE_NOT_FOUND',
    );
    expect(ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_PAYABLE).toBe(
      'MEMBERSHIP_PURCHASE_NOT_PAYABLE',
    );
    expect(ApiErrorCode.MEMBERSHIP_ENTITLEMENT_INCONSISTENT).toBe(
      'MEMBERSHIP_ENTITLEMENT_INCONSISTENT',
    );
  });

  it('exposes stable entitlement, payment, and grant states', () => {
    expect(MembershipEntitlementSegmentKind.INITIAL).toBe('INITIAL');
    expect(MembershipEntitlementSegmentKind.RENEWAL).toBe('RENEWAL');
    expect(MembershipEntitlementSegmentKind.UPGRADE).toBe('UPGRADE');
    expect(MembershipPaymentChannel.SIMULATED).toBe('SIMULATED');
    expect(MemberCreditGrantStatus.ACTIVE).toBe('ACTIVE');
    expect(MemberCreditGrantStatus.EXHAUSTED).toBe('EXHAUSTED');
    expect(MemberCreditGrantStatus.REVERSED).toBe('REVERSED');
    expect(MembershipPurchaseVoidReasonCode.CREDIT_USED).toBe('CREDIT_USED');
  });

  it('represents stable pending, fulfilled renewal, and voided lifecycles', () => {
    const purchaseBase = {
      userId: 'user-1',
      levelId: 'level-gold',
      levelCode: 'GOLD',
      levelName: '鎏金会员',
      levelRank: 20,
      priceCents: 50_000,
      grantCreditCents: 60_000,
      discountBasisPoints: 9_500,
      validDays: 365,
      benefits: [{ title: '全场九五折', sortOrder: 10 }],
      cardTheme: {
        theme: MembershipTheme.CHAMPAGNE,
        badgeText: 'GOLD MEMBER',
      },
      paymentChannel: MembershipPaymentChannel.SIMULATED,
      createdAt: '2026-07-22T07:59:00.000Z',
      updatedAt: '2026-07-22T08:00:00.000Z',
    };
    const detailBase = {
      grant: null,
      entries: [],
    };
    const segment = {
      id: 'segment-renewal',
      membershipId: 'membership-original',
      purchaseOrderId: 'purchase-renewal',
      kind: MembershipEntitlementSegmentKind.RENEWAL,
      startsAt: '2026-07-22T08:00:00.000Z',
      endsAt: '2027-07-22T08:00:00.000Z',
      previousMembershipId: null,
      previousMembershipEndsAt: null,
      createdAt: '2026-07-22T08:00:00.000Z',
    } as const;
    const membershipChain = [
      {
        id: segment.membershipId,
        userId: 'user-1',
        purchaseOrderId: 'purchase-initial',
        levelId: 'level-gold',
        levelCode: 'GOLD',
        levelName: '鎏金会员',
        levelRank: 20,
        discountBasisPoints: 9_500,
        benefits: [{ title: '全场九五折', sortOrder: 10 }],
        cardTheme: {
          theme: MembershipTheme.CHAMPAGNE,
          badgeText: 'GOLD MEMBER',
        },
        startsAt: '2025-07-22T08:00:00.000Z',
        endsAt: '2027-07-22T08:00:00.000Z',
        previousMembershipId: null,
        status: MembershipStatus.ACTIVE,
        createdAt: '2025-07-22T08:00:00.000Z',
        updatedAt: '2026-07-22T08:00:00.000Z',
      },
    ];

    const pending: AdminMembershipPurchaseDetailView = {
      ...detailBase,
      membershipChain: [],
      purchase: {
        ...purchaseBase,
        id: 'purchase-pending',
        purchaseNo: 'MP202607220000',
        status: MembershipPurchaseStatus.PENDING,
        paymentStatus: MembershipPaymentStatus.PENDING,
        membershipId: null,
        paidAt: null,
        voidedAt: null,
      },
      segment: null,
      voidability: {
        allowed: false,
        reasonCode: MembershipPurchaseVoidReasonCode.PURCHASE_NOT_FULFILLED,
        reason: '购卡单尚未完成',
      },
    };
    const fulfilled: AdminMembershipPurchaseDetailView = {
      ...detailBase,
      membershipChain,
      purchase: {
        ...purchaseBase,
        id: 'purchase-renewal',
        purchaseNo: 'MP202607220001',
        status: MembershipPurchaseStatus.FULFILLED,
        paymentStatus: MembershipPaymentStatus.SUCCEEDED,
        membershipId: segment.membershipId,
        paidAt: '2026-07-22T08:00:00.000Z',
        voidedAt: null,
      },
      segment,
      voidability: { allowed: true },
    };
    const voided: AdminMembershipPurchaseDetailView = {
      ...detailBase,
      membershipChain,
      purchase: {
        ...purchaseBase,
        id: 'purchase-voided',
        purchaseNo: 'MP202607220002',
        status: MembershipPurchaseStatus.VOIDED,
        paymentStatus: MembershipPaymentStatus.REVERSED,
        membershipId: segment.membershipId,
        paidAt: '2026-07-22T08:00:00.000Z',
        voidedAt: '2026-07-23T08:00:00.000Z',
      },
      segment,
      voidability: {
        allowed: false,
        reasonCode: MembershipPurchaseVoidReasonCode.PURCHASE_NOT_FULFILLED,
        reason: '购卡单已作废',
      },
    };

    const renewedMembership = fulfilled.membershipChain.find(
      ({ id }) => id === fulfilled.segment.membershipId,
    );

    expect(fulfilled.purchase.membershipId).toBe(
      fulfilled.segment.membershipId,
    );
    expect(fulfilled.purchase.id).toBe(fulfilled.segment.purchaseOrderId);
    expect(renewedMembership?.id).toBe(fulfilled.segment.membershipId);
    expect(renewedMembership?.purchaseOrderId).toBe('purchase-initial');
    expect(renewedMembership?.purchaseOrderId).not.toBe(fulfilled.purchase.id);

    expect([
      [
        pending.purchase.status,
        pending.purchase.paymentStatus,
        pending.segment,
      ],
      [
        fulfilled.purchase.status,
        fulfilled.purchase.paymentStatus,
        fulfilled.segment.membershipId,
      ],
      [
        voided.purchase.status,
        voided.purchase.paymentStatus,
        voided.purchase.voidedAt,
      ],
    ]).toEqual([
      [MembershipPurchaseStatus.PENDING, MembershipPaymentStatus.PENDING, null],
      [
        MembershipPurchaseStatus.FULFILLED,
        MembershipPaymentStatus.SUCCEEDED,
        'membership-original',
      ],
      [
        MembershipPurchaseStatus.VOIDED,
        MembershipPaymentStatus.REVERSED,
        '2026-07-23T08:00:00.000Z',
      ],
    ]);
  });
});
