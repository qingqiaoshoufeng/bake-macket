import { OrderStatus } from '@bake-mall/contracts';

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  [OrderStatus.NEW]: '新订单',
  [OrderStatus.PROCESSING]: '处理中',
  [OrderStatus.COMPLETED]: '已完成',
  [OrderStatus.CANCELLED]: '已取消',
};

export const FULFILLMENT_LABELS = {
  PICKUP: '到店自提',
  DELIVERY: '同城配送',
} as const;
