import {
  FulfillmentType,
  OrderStatus,
  PrintBatchStatus,
  PrintJobStatus,
  type AdminOrderListItem,
} from '@bake-mall/contracts';

export const PRINTING_ORDERS_PAGE_SIZE = 20;

export const PRINTABLE_ORDER_STATUSES = Object.freeze([
  OrderStatus.NEW,
  OrderStatus.PROCESSING,
] as const);

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  [OrderStatus.NEW]: '新订单',
  [OrderStatus.PROCESSING]: '制作中',
  [OrderStatus.COMPLETED]: '已完成',
  [OrderStatus.CANCELLED]: '已取消',
};

export const FULFILLMENT_LABELS: Readonly<Record<FulfillmentType, string>> = {
  [FulfillmentType.PICKUP]: '到店自提',
  [FulfillmentType.DELIVERY]: '配送',
};

export const PROCESSABLE_BATCH_STATUSES = Object.freeze([
  PrintBatchStatus.READY,
  PrintBatchStatus.PAUSED,
] as const);

export const PRINT_JOB_STATUS_LABELS: Readonly<Record<PrintJobStatus, string>> =
  {
    [PrintJobStatus.PENDING]: '待提交',
    [PrintJobStatus.SUBMITTING]: '提交中',
    [PrintJobStatus.ACCEPTED]: '厂商已接受',
    [PrintJobStatus.FAILED]: '明确失败',
    [PrintJobStatus.UNKNOWN]: '状态未知',
    [PrintJobStatus.MANUAL_REVIEW]: '人工复核',
    [PrintJobStatus.MANUALLY_CONFIRMED_PRINTED]: '人工确认已打印',
    [PrintJobStatus.MANUALLY_CLOSED]: '人工关闭',
    [PrintJobStatus.CANCELLED]: '已取消',
  };

export function isPrintableOrder(order: AdminOrderListItem): boolean {
  return PRINTABLE_ORDER_STATUSES.some((status) => status === order.status);
}

export function formatCents(value: number): string {
  return `¥${(value / 100).toFixed(2)}`;
}
