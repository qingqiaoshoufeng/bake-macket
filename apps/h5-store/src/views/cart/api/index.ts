import { customerApi } from '../../../api/customer.js';

export const cartFeatureApi = {
  list: () => customerApi.listCart(),
  upsert: (
    body: Parameters<typeof customerApi.upsertCartItem>[0],
    idempotencyKey?: string,
  ) => customerApi.upsertCartItem(body, idempotencyKey),
  remove: (id: string) => customerApi.removeCartItem(id),
};
