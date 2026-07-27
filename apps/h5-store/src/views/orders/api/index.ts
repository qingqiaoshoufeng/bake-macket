import { ordersApi } from '../../../api/orders.js';

export const ordersFeatureApi = {
  list: () => ordersApi.listMine(),
  getOne: (id: string) => ordersApi.getMine(id),
  create: (
    body: Parameters<typeof ordersApi.create>[0],
    idempotencyKey: string,
  ) => ordersApi.create(body, idempotencyKey),
};
