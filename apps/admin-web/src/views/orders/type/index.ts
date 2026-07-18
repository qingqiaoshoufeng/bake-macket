import type { FulfillmentType, OrderStatus } from '@bake-mall/contracts';

export type OrderFilterForm = {
  orderNo: string;
  status: OrderStatus | '';
  fulfillmentType: FulfillmentType | '';
  createdAtRange: readonly [Date, Date] | null;
};
