import type { OrderQuoteRequest, OrderQuoteView } from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';
import { ordersApi } from '../../../api/orders.js';

export const checkoutFeatureApi = {
  quote: (body: OrderQuoteRequest): Promise<OrderQuoteView> =>
    apiClient.post<OrderQuoteView>('/orders/quote', body),
  create: (
    body: Parameters<typeof ordersApi.create>[0],
    idempotencyKey: string,
  ) => ordersApi.create(body, idempotencyKey),
};
