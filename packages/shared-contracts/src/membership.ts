import type {
  AdminPageQuery,
  BooleanFilter,
  CreatedAtRangeQuery,
  PaginatedView,
  UpdatedAtRangeQuery,
} from './admin-list.js';

export enum MembershipLevelStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum MembershipTheme {
  PEARL = 'PEARL',
  CHAMPAGNE = 'CHAMPAGNE',
  JADE = 'JADE',
  OBSIDIAN = 'OBSIDIAN',
}

export enum MembershipStatus {
  ACTIVE = 'ACTIVE',
  REPLACED = 'REPLACED',
  VOIDED = 'VOIDED',
  EXPIRED = 'EXPIRED',
}

export enum MembershipPurchaseStatus {
  PENDING = 'PENDING',
  FULFILLED = 'FULFILLED',
  VOIDED = 'VOIDED',
}

export enum MembershipPaymentStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  REVERSED = 'REVERSED',
}

export enum MembershipPaymentChannel {
  SIMULATED = 'SIMULATED',
}

export enum MembershipEntitlementSegmentKind {
  INITIAL = 'INITIAL',
  RENEWAL = 'RENEWAL',
  UPGRADE = 'UPGRADE',
}

export enum MembershipPurchaseVoidReasonCode {
  PURCHASE_NOT_FULFILLED = 'PURCHASE_NOT_FULFILLED',
  CREDIT_USED = 'CREDIT_USED',
  MEMBERSHIP_CHAIN_NOT_RESTORABLE = 'MEMBERSHIP_CHAIN_NOT_RESTORABLE',
  SEGMENT_NOT_CHAIN_TAIL = 'SEGMENT_NOT_CHAIN_TAIL',
  MEMBERSHIP_BENEFIT_USED = 'MEMBERSHIP_BENEFIT_USED',
}

export enum MemberCreditGrantStatus {
  ACTIVE = 'ACTIVE',
  EXHAUSTED = 'EXHAUSTED',
  REVERSED = 'REVERSED',
}

export enum MemberCreditDirection {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export enum MemberCreditEntryType {
  MEMBERSHIP_PURCHASE_GRANT = 'MEMBERSHIP_PURCHASE_GRANT',
  PRODUCT_ORDER_DEBIT = 'PRODUCT_ORDER_DEBIT',
  PRODUCT_ORDER_CANCEL_REVERSAL = 'PRODUCT_ORDER_CANCEL_REVERSAL',
  MEMBERSHIP_PURCHASE_VOID_REVERSAL = 'MEMBERSHIP_PURCHASE_VOID_REVERSAL',
}

export type MembershipBenefit = {
  title: string;
  description?: string;
  iconKey?: string;
  sortOrder: number;
};

export type MembershipCardThemeView = {
  theme: MembershipTheme;
  badgeText: string;
};

export type PublicMembershipLevelView = {
  id: string;
  code: string;
  name: string;
  subtitle?: string;
  description?: string;
  rank: number;
  priceCents: number;
  grantCreditCents: number;
  discountBasisPoints: number;
  validDays: number;
  benefits: MembershipBenefit[];
  cardTheme: MembershipCardThemeView;
  sortOrder: number;
};

export type AdminMembershipLevelListItem = PublicMembershipLevelView & {
  status: MembershipLevelStatus;
  version: number;
  purchaseCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminMembershipLevelDetailView = AdminMembershipLevelListItem;

export type AdminMembershipLevelListQuery = AdminPageQuery &
  UpdatedAtRangeQuery & {
    q?: string;
    status?: MembershipLevelStatus;
    rank?: number;
    minPriceCents?: number;
    maxPriceCents?: number;
    minDiscountBasisPoints?: number;
    maxDiscountBasisPoints?: number;
    hasPurchases?: BooleanFilter;
    theme?: MembershipTheme;
    minValidDays?: number;
    maxValidDays?: number;
  };

export type AdminMembershipLevelListResult =
  PaginatedView<AdminMembershipLevelListItem>;

export type SaveMembershipLevelRequest = {
  code: string;
  name: string;
  subtitle?: string;
  description?: string;
  rank: number;
  priceCents: number;
  grantCreditCents: number;
  discountBasisPoints: number;
  validDays: number;
  benefits: MembershipBenefit[];
  cardTheme: MembershipCardThemeView;
  sortOrder: number;
  status: MembershipLevelStatus;
  version?: number;
};

export type CurrentMembershipView = {
  id: string;
  levelId: string;
  code: string;
  name: string;
  rank: number;
  discountBasisPoints: number;
  startsAt: string;
  endsAt: string;
  status: MembershipStatus;
  cardTheme: MembershipCardThemeView;
  benefits: MembershipBenefit[];
};

export type MembershipAccountView = {
  availableCreditCents: number;
  version: number;
};

export type MembershipOverviewView = {
  currentMembership: CurrentMembershipView | null;
  account: MembershipAccountView;
  levels: PublicMembershipLevelView[];
  simulatedPaymentEnabled: boolean;
};

export type MembershipPurchaseVoidability =
  | {
      allowed: true;
      reasonCode?: never;
      reason?: never;
    }
  | {
      allowed: false;
      reasonCode: MembershipPurchaseVoidReasonCode;
      reason: string;
    };

export type MembershipPurchaseView = {
  id: string;
  userId?: string;
  purchaseNo: string;
  levelId: string;
  levelCode: string;
  levelName: string;
  levelRank: number;
  priceCents: number;
  grantCreditCents: number;
  discountBasisPoints: number;
  validDays: number;
  cardTheme: MembershipCardThemeView;
  status: MembershipPurchaseStatus;
  paymentStatus: MembershipPaymentStatus;
  membershipId?: string;
  voidability?: MembershipPurchaseVoidability;
  paidAt?: string;
  voidedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateMembershipPurchaseRequest = {
  levelId: string;
};

export type AdminMembershipPurchaseListQuery = AdminPageQuery &
  CreatedAtRangeQuery & {
    purchaseNo?: string;
    userId?: string;
    userPhone?: string;
    levelId?: string;
    status?: MembershipPurchaseStatus;
    paymentStatus?: MembershipPaymentStatus;
    minPriceCents?: number;
    maxPriceCents?: number;
    voidable?: BooleanFilter;
    paidAtFrom?: string;
    paidAtBefore?: string;
    voidedAtFrom?: string;
    voidedAtBefore?: string;
  };

export type AdminMembershipPurchaseListResult =
  PaginatedView<MembershipPurchaseView>;

type MembershipEntitlementSegmentBaseView = {
  id: string;
  membershipId: string;
  purchaseOrderId: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
};

export type MembershipEntitlementSegmentView =
  | (MembershipEntitlementSegmentBaseView & {
      kind:
        | MembershipEntitlementSegmentKind.INITIAL
        | MembershipEntitlementSegmentKind.RENEWAL;
      previousMembershipId: null;
      previousMembershipEndsAt: null;
    })
  | (MembershipEntitlementSegmentBaseView & {
      kind: MembershipEntitlementSegmentKind.UPGRADE;
      previousMembershipId: string;
      previousMembershipEndsAt: string;
    });

export type AdminMembershipRecordView = {
  id: string;
  userId: string;
  purchaseOrderId: string;
  levelId: string;
  levelCode: string;
  levelName: string;
  levelRank: number;
  discountBasisPoints: number;
  benefits: MembershipBenefit[];
  cardTheme: MembershipCardThemeView;
  startsAt: string;
  endsAt: string;
  previousMembershipId: string | null;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
};

export type AdminMemberCreditGrantView = {
  id: string;
  accountId: string;
  purchaseOrderId: string;
  grantedCents: number;
  remainingCents: number;
  status: MemberCreditGrantStatus;
  createdAt: string;
  updatedAt: string;
};

export type AdminMemberCreditEntryView = {
  id: string;
  accountId: string;
  direction: MemberCreditDirection;
  type: MemberCreditEntryType;
  amountCents: number;
  balanceAfterCents: number;
  referenceType: string;
  referenceId: string;
  operationKey: string;
  reversalOfEntryId: string | null;
  createdAt: string;
};

type AdminMembershipPurchaseSnapshotBaseView = Omit<
  MembershipPurchaseView,
  | 'userId'
  | 'voidability'
  | 'membershipId'
  | 'paidAt'
  | 'voidedAt'
  | 'status'
  | 'paymentStatus'
> & {
  userId: string;
  benefits: MembershipBenefit[];
  paymentChannel: MembershipPaymentChannel;
};

export type AdminMembershipPurchaseSnapshotView =
  | (AdminMembershipPurchaseSnapshotBaseView & {
      status: MembershipPurchaseStatus.PENDING;
      paymentStatus: MembershipPaymentStatus.PENDING;
      membershipId: null;
      paidAt: null;
      voidedAt: null;
    })
  | (AdminMembershipPurchaseSnapshotBaseView & {
      status: MembershipPurchaseStatus.FULFILLED;
      paymentStatus: MembershipPaymentStatus.SUCCEEDED;
      membershipId: string;
      paidAt: string;
      voidedAt: null;
    })
  | (AdminMembershipPurchaseSnapshotBaseView & {
      status: MembershipPurchaseStatus.VOIDED;
      paymentStatus: MembershipPaymentStatus.REVERSED;
      membershipId: string;
      paidAt: string;
      voidedAt: string;
    });

type AdminMembershipPurchaseDetailBaseView = {
  membershipChain: AdminMembershipRecordView[];
  grant: AdminMemberCreditGrantView | null;
  entries: AdminMemberCreditEntryView[];
  voidability: MembershipPurchaseVoidability;
};

export type AdminMembershipPurchaseDetailView =
  | (AdminMembershipPurchaseDetailBaseView & {
      purchase: Extract<
        AdminMembershipPurchaseSnapshotView,
        { status: MembershipPurchaseStatus.PENDING }
      >;
      segment: null;
    })
  | (AdminMembershipPurchaseDetailBaseView & {
      purchase: Extract<
        AdminMembershipPurchaseSnapshotView,
        {
          status:
            | MembershipPurchaseStatus.FULFILLED
            | MembershipPurchaseStatus.VOIDED;
        }
      >;
      segment: MembershipEntitlementSegmentView;
    });

export type MemberCreditEntryView = {
  id: string;
  direction: MemberCreditDirection;
  type: MemberCreditEntryType;
  amountCents: number;
  balanceAfterCents: number;
  referenceType: string;
  referenceId: string;
  createdAt: string;
};

export type OrderQuoteRequest = {
  cartItemIds: string[];
  requestedCreditCents: number;
};

export type OrderQuoteLineView = {
  cartItemId: string;
  productName: string;
  skuName: string;
  quantity: number;
  unitPriceCents: number;
  lineGoodsTotalCents: number;
  lineMembershipDiscountCents: number;
  linePayableCents: number;
};

export type OrderQuoteView = {
  lines: OrderQuoteLineView[];
  goodsTotalCents: number;
  membershipDiscountCents: number;
  discountedTotalCents: number;
  availableCreditCents: number;
  maxCreditCents: number;
  requestedCreditCents: number;
  creditAppliedCents: number;
  payableTotalCents: number;
  membership: CurrentMembershipView | null;
  quoteToken: string;
  expiresAt: string;
};
