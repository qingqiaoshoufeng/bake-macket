import type {
  AdminPageQuery,
  BooleanFilter,
  CreatedAtRangeQuery,
  PaginatedView,
} from './admin-list.js';
import {
  AdminOrderExportView,
  AdminOrderSupplyMatchType,
  FulfillmentType,
  OrderStatus,
} from './enums.js';
import type { OrderView } from './order.js';

export const SUPPLY_ORDER_STATUSES = [
  OrderStatus.NEW,
  OrderStatus.PROCESSING,
] as const;

export type SupplyOrderStatus = (typeof SUPPLY_ORDER_STATUSES)[number];

export type AdminOrderFilterQuery = CreatedAtRangeQuery & {
  orderNo?: string;
  contact?: string;
  fulfillmentType?: FulfillmentType;
  userId?: string;
  itemQ?: string;
  usesMembership?: BooleanFilter;
  usesCredit?: BooleanFilter;
  hasRemark?: BooleanFilter;
  minPayableCents?: number;
  maxPayableCents?: number;
};

export type AdminOrderListQuery = AdminOrderFilterQuery &
  AdminPageQuery & {
    status?: OrderStatus;
  };

export type AdminOrderSupplyQuery = AdminOrderFilterQuery &
  AdminPageQuery & {
    supplyStatuses: readonly SupplyOrderStatus[];
  };

export type AdminOrderSupplyDetailQuery = AdminOrderFilterQuery &
  AdminPageQuery & {
    groupKey: string;
    supplyStatuses: readonly SupplyOrderStatus[];
  };

export type AdminOrderExportQuery =
  | (AdminOrderFilterQuery & {
      view: AdminOrderExportView.ORDER;
      status?: OrderStatus;
      supplyStatuses?: never;
    })
  | (AdminOrderFilterQuery & {
      view: AdminOrderExportView.SUPPLY;
      supplyStatuses: readonly SupplyOrderStatus[];
      status?: never;
    });

export type AdminOrderListItem = {
  id: string;
  orderNo: string;
  userId: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  contactName: string;
  contactPhone: string;
  itemLineCount: number;
  totalQuantity: number;
  goodsTotalCents: number;
  membershipDiscountCents: number;
  creditAppliedCents: number;
  payableTotalCents: number;
  pickupTimeText?: string;
  deliveryAddressText?: string;
  membershipCode?: string;
  membershipName?: string;
  membershipDiscountBasisPoints?: number;
  remark?: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminOrderSupplyItem = {
  groupKey: string;
  matchType: AdminOrderSupplyMatchType;
  productId?: string;
  skuId?: string;
  productName: string;
  skuName: string;
  skuAttributes: Readonly<Record<string, string>>;
  requiredQuantity: number;
  orderCount: number;
  newQuantity: number;
  processingQuantity: number;
  remainingSaleableStock?: number;
  earliestOrderCreatedAt: string;
};

export type AdminOrderSupplyDetailItem = {
  orderItemId: string;
  orderId: string;
  orderNo: string;
  status: SupplyOrderStatus;
  fulfillmentType: FulfillmentType;
  contactName: string;
  contactPhone: string;
  pickupTimeText?: string;
  deliveryAddressText?: string;
  productId?: string;
  skuId?: string;
  productName: string;
  skuName: string;
  skuAttributes: Readonly<Record<string, string>>;
  quantity: number;
  unitPriceCents: number;
  lineGoodsTotalCents: number;
  lineMembershipDiscountCents: number;
  linePayableCents: number;
  remark?: string;
  orderCreatedAt: string;
};

export type AdminOrderListResult = PaginatedView<AdminOrderListItem>;
export type AdminOrderSupplyResult = PaginatedView<AdminOrderSupplyItem>;
export type AdminOrderSupplyDetailResult =
  PaginatedView<AdminOrderSupplyDetailItem>;

export type OrderStatusUpdateResult = {
  order: OrderView;
  noRestock: boolean;
};
