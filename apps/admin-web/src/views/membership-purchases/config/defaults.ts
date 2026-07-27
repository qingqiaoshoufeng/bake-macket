import type { MembershipPurchaseFilterForm } from '../type/index.js';

export function createMembershipPurchaseFilterDefaults(): MembershipPurchaseFilterForm {
  return {
    purchaseNo: '',
    userPhone: '',
    levelId: '',
    status: '',
    paymentStatus: '',
    minPriceYuan: '',
    maxPriceYuan: '',
    voidable: '',
    createdAtRange: null,
    paidAtRange: null,
    voidedAtRange: null,
  };
}
