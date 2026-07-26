import type { OrderFilterForm } from '../type/index.js';

export const createOrderFilterDefaults = (): OrderFilterForm => ({
  orderNo: '',
  status: '',
  fulfillmentType: '',
  createdAtRange: null,
});
