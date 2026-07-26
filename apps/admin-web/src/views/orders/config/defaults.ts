import type { OrderFilterForm } from '../type/index.js';

export const createOrderFilterDefaults = (): OrderFilterForm => ({
  orderNo: '',
  contact: '',
  status: '',
  fulfillmentType: '',
  userId: '',
  itemQ: '',
  usesMembership: '',
  usesCredit: '',
  hasRemark: '',
  minPayableYuan: '',
  maxPayableYuan: '',
  createdAtRange: null,
});
