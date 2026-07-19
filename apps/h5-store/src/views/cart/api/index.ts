import { customerApi } from '../../../api/customer.js';

export const cartFeatureApi = {
  list: () => customerApi.listCart(),
  upsert: (body: Parameters<typeof customerApi.upsertCartItem>[0]) =>
    customerApi.upsertCartItem(body),
  remove: (id: string) => customerApi.removeCartItem(id),
};
