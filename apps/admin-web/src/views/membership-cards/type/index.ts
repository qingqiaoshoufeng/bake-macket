import type {
  ApiErrorCode,
  BooleanFilter,
  MembershipBenefit,
  MembershipLevelStatus,
  MembershipTheme,
} from '@bake-mall/contracts';

export type MembershipCardForm = {
  readonly code: string;
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly rank: number;
  readonly priceYuan: string;
  readonly grantCreditYuan: string;
  readonly discountText: string;
  readonly validDays: number;
  readonly benefits: readonly MembershipBenefit[];
  readonly theme: MembershipTheme;
  readonly badgeText: string;
  readonly sortOrder: number;
  readonly status: MembershipLevelStatus;
  readonly version?: number;
};

export type MembershipCardFilters = {
  q: string;
  status: MembershipLevelStatus | '';
  rank: number | null;
  minPriceYuan: string;
  maxPriceYuan: string;
  minDiscountText: string;
  maxDiscountText: string;
  hasPurchases: BooleanFilter | '';
  theme: MembershipTheme | '';
  minValidDays: number | null;
  maxValidDays: number | null;
  updatedAtRange: readonly [Date, Date] | null;
};

export type MembershipLevelConflict = {
  readonly code: ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT;
  readonly message: string;
  readonly details?: Record<string, unknown>;
};
