import {
  FulfillmentType,
  OrderStatus,
  type OrderView,
} from '@bake-mall/contracts';

export const orderListMock: readonly OrderView[] = [
  {
    id: 'order-demo',
    orderNo: 'BM2026071900000001',
    status: OrderStatus.NEW,
    fulfillmentType: FulfillmentType.PICKUP,
    contactName: '小明',
    contactPhone: '13800000000',
    pickupTimeText: '明天上午十点',
    goodsTotalCents: 6800,
    membershipDiscountCents: 0,
    creditAppliedCents: 0,
    payableTotalCents: 6800,
    pricingVersion: 1,
    items: [],
    createdAt: '2026-07-19T08:00:00.000Z',
    updatedAt: '2026-07-19T08:00:00.000Z',
  },
];
