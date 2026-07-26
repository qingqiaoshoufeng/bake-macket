import type {
  ApiErrorCode,
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
  readonly q: string;
  readonly status: MembershipLevelStatus | '';
};

export type MembershipLevelConflict = {
  readonly code: ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT;
  readonly message: string;
  readonly details?: Record<string, unknown>;
};
