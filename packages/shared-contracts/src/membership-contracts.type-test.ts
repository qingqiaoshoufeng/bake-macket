import {
  ApiErrorCode,
  MemberCreditDirection,
  MemberCreditEntryType,
  MemberCreditGrantStatus,
  MembershipEntitlementSegmentKind,
  MembershipLevelStatus,
  MembershipPaymentChannel,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipPurchaseVoidReasonCode,
  MembershipStatus,
  MembershipTheme,
  type AdminMembershipPurchaseDetailView,
  type AdminMembershipPurchaseSnapshotView,
  type MembershipEntitlementSegmentView,
  type MembershipOverviewView,
  type MembershipPurchaseVoidability,
  type SaveMembershipLevelRequest,
} from './index.js';

const validLevel: SaveMembershipLevelRequest = {
  code: 'GOLD',
  name: '鎏金会员',
  rank: 20,
  priceCents: 50_000,
  grantCreditCents: 60_000,
  discountBasisPoints: 9_500,
  validDays: 365,
  benefits: [{ title: '全场九五折', sortOrder: 10 }],
  cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'GOLD MEMBER' },
  sortOrder: 20,
  status: MembershipLevelStatus.ACTIVE,
};

const membershipConflictCode: ApiErrorCode =
  ApiErrorCode.MEMBERSHIP_LEVEL_CONFLICT;

const validOverview: MembershipOverviewView = {
  currentMembership: null,
  account: { availableCreditCents: 0, version: 1 },
  levels: [],
  simulatedPaymentEnabled: false,
};

const invalidTheme: SaveMembershipLevelRequest = {
  ...validLevel,
  cardTheme: {
    // @ts-expect-error theme must use MembershipTheme.
    theme: 'RAINBOW',
    badgeText: 'INVALID',
  },
};

const initialSegment: MembershipEntitlementSegmentView = {
  id: 'segment-initial',
  membershipId: 'membership-initial',
  purchaseOrderId: 'purchase-initial',
  kind: MembershipEntitlementSegmentKind.INITIAL,
  startsAt: '2025-07-22T08:00:00.000Z',
  endsAt: '2026-07-22T08:00:00.000Z',
  previousMembershipId: null,
  previousMembershipEndsAt: null,
  createdAt: '2025-07-22T08:00:00.000Z',
};

const renewalSegment: MembershipEntitlementSegmentView = {
  ...initialSegment,
  id: 'segment-renewal',
  membershipId: 'membership-original',
  purchaseOrderId: 'purchase-renewal',
  kind: MembershipEntitlementSegmentKind.RENEWAL,
  startsAt: '2026-07-22T08:00:00.000Z',
  endsAt: '2027-07-22T08:00:00.000Z',
  createdAt: '2026-07-22T08:00:00.000Z',
};

const upgradeSegment: MembershipEntitlementSegmentView = {
  ...initialSegment,
  id: 'segment-upgrade',
  membershipId: 'membership-upgrade',
  purchaseOrderId: 'purchase-upgrade',
  kind: MembershipEntitlementSegmentKind.UPGRADE,
  previousMembershipId: 'membership-original',
  previousMembershipEndsAt: '2027-07-22T08:00:00.000Z',
  createdAt: '2026-08-22T08:00:00.000Z',
};

const invalidSegmentKind: MembershipEntitlementSegmentView = {
  ...renewalSegment,
  // @ts-expect-error entitlement segment kind must use the shared enum.
  kind: 'EXTENSION',
};

// @ts-expect-error INITIAL cannot carry previousMembershipId.
const initialWithPreviousMembershipId: MembershipEntitlementSegmentView = {
  ...initialSegment,
  previousMembershipId: 'membership-previous',
};

// @ts-expect-error INITIAL cannot carry previousMembershipEndsAt.
const initialWithPreviousMembershipEndsAt: MembershipEntitlementSegmentView = {
  ...initialSegment,
  previousMembershipEndsAt: '2025-07-22T08:00:00.000Z',
};

// @ts-expect-error RENEWAL cannot carry previousMembershipId.
const renewalWithPreviousMembershipId: MembershipEntitlementSegmentView = {
  ...renewalSegment,
  previousMembershipId: 'membership-previous',
};

// @ts-expect-error RENEWAL cannot carry previousMembershipEndsAt.
const renewalWithPreviousMembershipEndsAt: MembershipEntitlementSegmentView = {
  ...renewalSegment,
  previousMembershipEndsAt: '2026-07-22T08:00:00.000Z',
};

const {
  previousMembershipId: omittedUpgradePreviousMembershipId,
  ...upgradeWithoutPreviousMembershipId
} = upgradeSegment;
// @ts-expect-error UPGRADE requires previousMembershipId.
const upgradeMissingPreviousMembershipId: MembershipEntitlementSegmentView =
  upgradeWithoutPreviousMembershipId;

const {
  previousMembershipEndsAt: omittedUpgradePreviousMembershipEndsAt,
  ...upgradeWithoutPreviousMembershipEndsAt
} = upgradeSegment;
// @ts-expect-error UPGRADE requires previousMembershipEndsAt.
const upgradeMissingPreviousMembershipEndsAt: MembershipEntitlementSegmentView =
  upgradeWithoutPreviousMembershipEndsAt;

const purchaseSnapshotBase = {
  id: 'purchase-renewal',
  userId: 'user-1',
  purchaseNo: 'MP202607220001',
  levelId: 'level-gold',
  levelCode: 'GOLD',
  levelName: '鎏金会员',
  levelRank: 20,
  priceCents: 50_000,
  grantCreditCents: 60_000,
  discountBasisPoints: 9_500,
  validDays: 365,
  benefits: [{ title: '全场九五折', sortOrder: 10 }],
  cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'GOLD MEMBER' },
  paymentChannel: MembershipPaymentChannel.SIMULATED,
  createdAt: '2026-07-22T07:59:00.000Z',
  updatedAt: '2026-07-22T08:00:00.000Z',
};

const pendingPurchase: AdminMembershipPurchaseSnapshotView = {
  ...purchaseSnapshotBase,
  status: MembershipPurchaseStatus.PENDING,
  paymentStatus: MembershipPaymentStatus.PENDING,
  membershipId: null,
  paidAt: null,
  voidedAt: null,
};

const fulfilledPurchase: AdminMembershipPurchaseSnapshotView = {
  ...purchaseSnapshotBase,
  status: MembershipPurchaseStatus.FULFILLED,
  paymentStatus: MembershipPaymentStatus.SUCCEEDED,
  membershipId: renewalSegment.membershipId,
  paidAt: '2026-07-22T08:00:00.000Z',
  voidedAt: null,
};

const voidedPurchase: AdminMembershipPurchaseSnapshotView = {
  ...purchaseSnapshotBase,
  status: MembershipPurchaseStatus.VOIDED,
  paymentStatus: MembershipPaymentStatus.REVERSED,
  membershipId: renewalSegment.membershipId,
  paidAt: '2026-07-22T08:00:00.000Z',
  voidedAt: '2026-07-23T08:00:00.000Z',
};

// @ts-expect-error PENDING requires paymentStatus: PENDING.
const pendingWithSucceededPayment: AdminMembershipPurchaseSnapshotView = {
  ...pendingPurchase,
  paymentStatus: MembershipPaymentStatus.SUCCEEDED,
};

// @ts-expect-error FULFILLED requires paymentStatus: SUCCEEDED.
const fulfilledWithPendingPayment: AdminMembershipPurchaseSnapshotView = {
  ...fulfilledPurchase,
  paymentStatus: MembershipPaymentStatus.PENDING,
};

// @ts-expect-error VOIDED requires paymentStatus: REVERSED.
const voidedWithSucceededPayment: AdminMembershipPurchaseSnapshotView = {
  ...voidedPurchase,
  paymentStatus: MembershipPaymentStatus.SUCCEEDED,
};

const membershipChain = [
  {
    id: renewalSegment.membershipId,
    userId: 'user-1',
    purchaseOrderId: 'purchase-initial',
    levelId: 'level-gold',
    levelCode: 'GOLD',
    levelName: '鎏金会员',
    levelRank: 20,
    discountBasisPoints: 9_500,
    benefits: [{ title: '全场九五折', sortOrder: 10 }],
    cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'GOLD MEMBER' },
    startsAt: '2025-07-22T08:00:00.000Z',
    endsAt: '2027-07-22T08:00:00.000Z',
    previousMembershipId: null,
    status: MembershipStatus.ACTIVE,
    createdAt: '2025-07-22T08:00:00.000Z',
    updatedAt: '2026-07-22T08:00:00.000Z',
  },
];

const grant = {
  id: 'grant-renewal',
  accountId: 'account-1',
  purchaseOrderId: 'purchase-renewal',
  grantedCents: 60_000,
  remainingCents: 60_000,
  status: MemberCreditGrantStatus.ACTIVE,
  createdAt: '2026-07-22T08:00:00.000Z',
  updatedAt: '2026-07-22T08:00:00.000Z',
};

const entries = [
  {
    id: 'entry-renewal',
    accountId: 'account-1',
    direction: MemberCreditDirection.CREDIT,
    type: MemberCreditEntryType.MEMBERSHIP_PURCHASE_GRANT,
    amountCents: 60_000,
    balanceAfterCents: 60_000,
    referenceType: 'MEMBERSHIP_PURCHASE',
    referenceId: 'purchase-renewal',
    operationKey: 'membership-purchase:purchase-renewal:grant',
    reversalOfEntryId: null,
    createdAt: '2026-07-22T08:00:00.000Z',
  },
];

const pendingPurchaseDetail: AdminMembershipPurchaseDetailView = {
  purchase: pendingPurchase,
  membershipChain: [],
  segment: null,
  grant: null,
  entries: [],
  voidability: {
    allowed: false,
    reasonCode: MembershipPurchaseVoidReasonCode.PURCHASE_NOT_FULFILLED,
    reason: '购卡单尚未完成',
  },
};

const renewalPurchaseDetail: AdminMembershipPurchaseDetailView = {
  purchase: fulfilledPurchase,
  membershipChain,
  segment: renewalSegment,
  grant,
  entries,
  voidability: { allowed: true },
};

const voidedPurchaseDetail: AdminMembershipPurchaseDetailView = {
  purchase: voidedPurchase,
  membershipChain,
  segment: renewalSegment,
  grant: { ...grant, status: MemberCreditGrantStatus.REVERSED },
  entries,
  voidability: {
    allowed: false,
    reasonCode: MembershipPurchaseVoidReasonCode.PURCHASE_NOT_FULFILLED,
    reason: '购卡单已作废',
  },
};

// @ts-expect-error PENDING requires membershipId: null.
const pendingWithMembershipId: AdminMembershipPurchaseSnapshotView = {
  ...pendingPurchase,
  membershipId: 'membership-unexpected',
};

// @ts-expect-error PENDING requires paidAt: null.
const pendingWithPaidAt: AdminMembershipPurchaseSnapshotView = {
  ...pendingPurchase,
  paidAt: '2026-07-22T08:00:00.000Z',
};

// @ts-expect-error PENDING requires voidedAt: null.
const pendingWithVoidedAt: AdminMembershipPurchaseSnapshotView = {
  ...pendingPurchase,
  voidedAt: '2026-07-22T08:00:00.000Z',
};

// @ts-expect-error FULFILLED detail requires a non-null segment.
const fulfilledWithNullSegment: AdminMembershipPurchaseDetailView = {
  ...renewalPurchaseDetail,
  segment: null,
};

// @ts-expect-error FULFILLED requires membershipId: string.
const fulfilledWithNullMembershipId: AdminMembershipPurchaseSnapshotView = {
  ...fulfilledPurchase,
  membershipId: null,
};

// @ts-expect-error FULFILLED requires paidAt: string.
const fulfilledWithNullPaidAt: AdminMembershipPurchaseSnapshotView = {
  ...fulfilledPurchase,
  paidAt: null,
};

// @ts-expect-error FULFILLED requires voidedAt: null.
const fulfilledWithVoidedAt: AdminMembershipPurchaseSnapshotView = {
  ...fulfilledPurchase,
  voidedAt: '2026-07-23T08:00:00.000Z',
};

// @ts-expect-error VOIDED requires membershipId: string.
const voidedWithNullMembershipId: AdminMembershipPurchaseSnapshotView = {
  ...voidedPurchase,
  membershipId: null,
};

// @ts-expect-error VOIDED requires paidAt: string.
const voidedWithNullPaidAt: AdminMembershipPurchaseSnapshotView = {
  ...voidedPurchase,
  paidAt: null,
};

// @ts-expect-error VOIDED requires voidedAt: string.
const voidedWithNullVoidedAt: AdminMembershipPurchaseSnapshotView = {
  ...voidedPurchase,
  voidedAt: null,
};

// @ts-expect-error detail requires membershipChain.
const detailMissingMembershipChain: AdminMembershipPurchaseDetailView = {
  purchase: fulfilledPurchase,
  segment: renewalSegment,
  grant,
  entries,
  voidability: { allowed: true },
};

// @ts-expect-error detail requires segment.
const detailMissingSegment: AdminMembershipPurchaseDetailView = {
  purchase: fulfilledPurchase,
  membershipChain,
  grant,
  entries,
  voidability: { allowed: true },
};

// @ts-expect-error detail requires grant, even when its value is null.
const detailMissingGrant: AdminMembershipPurchaseDetailView = {
  purchase: fulfilledPurchase,
  membershipChain,
  segment: renewalSegment,
  entries,
  voidability: { allowed: true },
};

// @ts-expect-error detail requires entries.
const detailMissingEntries: AdminMembershipPurchaseDetailView = {
  purchase: fulfilledPurchase,
  membershipChain,
  segment: renewalSegment,
  grant,
  voidability: { allowed: true },
};

// @ts-expect-error detail requires voidability.
const detailMissingVoidability: AdminMembershipPurchaseDetailView = {
  purchase: fulfilledPurchase,
  membershipChain,
  segment: renewalSegment,
  grant,
  entries,
};

const { userId: omittedUserId, ...purchaseWithoutUserId } = fulfilledPurchase;
// @ts-expect-error admin purchase snapshot requires userId.
const purchaseMissingUserId: AdminMembershipPurchaseSnapshotView =
  purchaseWithoutUserId;

const { benefits: omittedBenefits, ...purchaseWithoutBenefits } =
  fulfilledPurchase;
// @ts-expect-error admin purchase snapshot requires benefits.
const purchaseMissingBenefits: AdminMembershipPurchaseSnapshotView =
  purchaseWithoutBenefits;

const {
  paymentChannel: omittedPaymentChannel,
  ...purchaseWithoutPaymentChannel
} = fulfilledPurchase;
// @ts-expect-error admin purchase snapshot requires paymentChannel.
const purchaseMissingPaymentChannel: AdminMembershipPurchaseSnapshotView =
  purchaseWithoutPaymentChannel;

const purchaseWithVoidability: AdminMembershipPurchaseSnapshotView = {
  ...fulfilledPurchase,
  // @ts-expect-error admin purchase snapshot cannot contain voidability.
  voidability: { allowed: true },
};

// @ts-expect-error rejected voidability requires reasonCode.
const rejectedWithoutReasonCode: MembershipPurchaseVoidability = {
  allowed: false,
  reason: '赠送消费金已使用',
};

// @ts-expect-error rejected voidability requires reason.
const rejectedWithoutReason: MembershipPurchaseVoidability = {
  allowed: false,
  reasonCode: MembershipPurchaseVoidReasonCode.CREDIT_USED,
};

// @ts-expect-error allowed voidability cannot contain reasonCode.
const allowedWithReasonCode: MembershipPurchaseVoidability = {
  allowed: true,
  reasonCode: MembershipPurchaseVoidReasonCode.CREDIT_USED,
};

// @ts-expect-error allowed voidability cannot contain reason.
const allowedWithReason: MembershipPurchaseVoidability = {
  allowed: true,
  reason: '赠送消费金已使用',
};

void [
  validLevel,
  validOverview,
  invalidTheme,
  membershipConflictCode,
  initialSegment,
  renewalSegment,
  upgradeSegment,
  invalidSegmentKind,
  initialWithPreviousMembershipId,
  initialWithPreviousMembershipEndsAt,
  renewalWithPreviousMembershipId,
  renewalWithPreviousMembershipEndsAt,
  omittedUpgradePreviousMembershipId,
  upgradeMissingPreviousMembershipId,
  omittedUpgradePreviousMembershipEndsAt,
  upgradeMissingPreviousMembershipEndsAt,
  pendingPurchaseDetail,
  renewalPurchaseDetail,
  voidedPurchaseDetail,
  pendingWithSucceededPayment,
  fulfilledWithPendingPayment,
  voidedWithSucceededPayment,
  pendingWithMembershipId,
  pendingWithPaidAt,
  pendingWithVoidedAt,
  fulfilledWithNullSegment,
  fulfilledWithNullMembershipId,
  fulfilledWithNullPaidAt,
  fulfilledWithVoidedAt,
  voidedWithNullMembershipId,
  voidedWithNullPaidAt,
  voidedWithNullVoidedAt,
  detailMissingMembershipChain,
  detailMissingSegment,
  detailMissingGrant,
  detailMissingEntries,
  detailMissingVoidability,
  omittedUserId,
  purchaseMissingUserId,
  omittedBenefits,
  purchaseMissingBenefits,
  omittedPaymentChannel,
  purchaseMissingPaymentChannel,
  purchaseWithVoidability,
  rejectedWithoutReasonCode,
  rejectedWithoutReason,
  allowedWithReasonCode,
  allowedWithReason,
];
