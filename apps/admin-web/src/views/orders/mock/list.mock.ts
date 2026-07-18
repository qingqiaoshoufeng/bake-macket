import {
  FulfillmentType,
  OrderStatus,
  type AdminOrderListItem,
} from '@bake-mall/contracts';

export const orderListMock: readonly AdminOrderListItem[] = [
  {
    id: 'order-preview',
    orderNo: 'BM2026071800000001',
    status: OrderStatus.NEW,
    fulfillmentType: FulfillmentType.PICKUP,
    contactName: '张三',
    contactPhone: '13800000000',
    goodsTotalCents: 6800,
    createdAt: '2026-07-18T08:00:00.000Z',
    updatedAt: '2026-07-18T08:00:00.000Z',
  },
];
