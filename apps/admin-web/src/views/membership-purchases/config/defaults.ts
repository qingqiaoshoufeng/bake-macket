import type { MembershipPurchaseFilterForm } from '../type/index.js';

export function createMembershipPurchaseFilterDefaults(): MembershipPurchaseFilterForm {
  return {
    purchaseNo: '',
    userId: '',
    levelId: '',
    status: '',
    createdAtRange: null,
  };
}
