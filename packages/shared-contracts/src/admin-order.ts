import type {
  AdminPageQuery,
  BooleanFilter,
  CreatedAtRangeQuery,
  PaginatedView,
} from './admin-list.js';
import type { FulfillmentType, OrderStatus } from './enums.js';
import type { OrderView } from './order.js';

export type AdminOrderListQuery = AdminPageQuery &
  CreatedAtRangeQuery & {
    orderNo?: string;
    contact?: string;
    status?: OrderStatus;
    fulfillmentType?: FulfillmentType;
    userId?: string;
    itemQ?: string;
    usesMembership?: BooleanFilter;
    usesCredit?: BooleanFilter;
    hasRemark?: BooleanFilter;
    minPayableCents?: number;
    maxPayableCents?: number;
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

export type AdminOrderListResult = PaginatedView<AdminOrderListItem>;

export type OrderStatusUpdateResult = {
  order: OrderView;
  noRestock: boolean;
};
