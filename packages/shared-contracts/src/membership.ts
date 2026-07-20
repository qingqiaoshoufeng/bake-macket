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

export type AdminMembershipLevelListQuery = {
  q?: string;
  status?: MembershipLevelStatus;
};

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

export type MembershipPurchaseVoidability = {
  allowed: boolean;
  reason?: string;
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

export type AdminMembershipPurchaseListQuery = {
  purchaseNo?: string;
  userId?: string;
  levelId?: string;
  status?: MembershipPurchaseStatus;
  createdAtFrom?: string;
  createdAtBefore?: string;
  page: number;
  pageSize: number;
};

export type AdminMembershipPurchaseListResult = {
  items: MembershipPurchaseView[];
  page: number;
  pageSize: number;
  total: number;
};

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
