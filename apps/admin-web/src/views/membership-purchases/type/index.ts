import type {
  BooleanFilter,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
} from '@bake-mall/contracts';

export type MembershipPurchaseFilterForm = {
  purchaseNo: string;
  userPhone: string;
  levelId: string;
  status: MembershipPurchaseStatus | '';
  paymentStatus: MembershipPaymentStatus | '';
  minPriceYuan: string;
  maxPriceYuan: string;
  voidable: BooleanFilter | '';
  createdAtRange: readonly [Date, Date] | null;
  paidAtRange: readonly [Date, Date] | null;
  voidedAtRange: readonly [Date, Date] | null;
};

export type MembershipLevelOption = {
  readonly value: string;
  readonly label: string;
};
