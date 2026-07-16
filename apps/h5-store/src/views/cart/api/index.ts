import { customerApi } from '../../../api/customer.js';

export const cartFeatureApi = {
  list: customerApi.listCart.bind(customerApi),
  upsert: customerApi.upsertCartItem.bind(customerApi),
  remove: customerApi.removeCartItem.bind(customerApi),
};
