import type { FulfillmentType, OrderStatus } from './enums.js';
import type { OrderView } from './order.js';

export type AdminOrderListQuery = {
  orderNo?: string;
  status?: OrderStatus;
  fulfillmentType?: FulfillmentType;
  createdAtFrom?: string;
  createdAtBefore?: string;
  page: number;
  pageSize: number;
};

export type AdminOrderListItem = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  contactName: string;
  contactPhone: string;
  goodsTotalCents: number;
  membershipDiscountCents?: number;
  creditAppliedCents?: number;
  payableTotalCents?: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminOrderListResult = {
  items: AdminOrderListItem[];
  page: number;
  pageSize: number;
  total: number;
};

export type OrderStatusUpdateResult = {
  order: OrderView;
  noRestock: boolean;
};
