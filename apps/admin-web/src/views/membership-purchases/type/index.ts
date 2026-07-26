import type { MembershipPurchaseStatus } from '@bake-mall/contracts';

export type MembershipPurchaseFilterForm = {
  purchaseNo: string;
  userId: string;
  levelId: string;
  status: MembershipPurchaseStatus | '';
  createdAtRange: readonly [Date, Date] | null;
};
