import { ordersApi } from '../../../api/orders.js';

export const checkoutFeatureApi = {
  create: (
    body: Parameters<typeof ordersApi.create>[0],
    idempotencyKey: string,
  ) => ordersApi.create(body, idempotencyKey),
};
