import {
  FulfillmentType,
  OrderStatus,
  type CreateOrderRequest,
  type OrderItemView,
  type OrderView,
} from './index.js';

const validCreateOrder: CreateOrderRequest = {
  cartItemIds: ['cart-1'],
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '张三',
  orderContactPhoneVersion: 1,
  pickupTimeText: '明天 10:00',
  requestedCreditCents: 0,
  quoteToken: 'quote-token',
};

const invalidCreateOrder: CreateOrderRequest = {
  ...validCreateOrder,
  // @ts-expect-error 创建订单不允许客户端提交完整联系手机号。
  contactPhone: '13800000000',
};

const completeItem: OrderItemView = {
  id: 'item-1',
  productName: '草莓蛋糕',
  skuName: '6寸',
  skuAttributes: { size: '6寸' },
  unitPriceCents: 6_800,
  quantity: 1,
  lineGoodsTotalCents: 6_800,
  lineMembershipDiscountCents: 680,
  linePayableCents: 6_120,
};

const completeOrder: OrderView = {
  id: 'order-1',
  orderNo: 'BM2026072500000001',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '张三',
  contactPhone: '13800000000',
  pickupTimeText: '明天 10:00',
  goodsTotalCents: 6_800,
  membershipDiscountCents: 680,
  creditAppliedCents: 500,
  payableTotalCents: 5_620,
  membershipId: 'membership-1',
  membershipCode: 'GOLD',
  membershipName: '鎏金会员',
  membershipDiscountBasisPoints: 9_000,
  pricingVersion: 1,
  items: [completeItem],
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
};

const legacyOrder: OrderView = {
  ...completeOrder,
  membershipDiscountCents: 0,
  creditAppliedCents: 0,
  payableTotalCents: 6_800,
  items: [
    {
      ...completeItem,
      lineMembershipDiscountCents: 0,
      linePayableCents: 6_800,
    },
  ],
  membershipId: undefined,
  membershipCode: undefined,
  membershipName: undefined,
  membershipDiscountBasisPoints: undefined,
};

const { linePayableCents: omittedLinePayable, ...itemWithoutLinePayable } =
  completeItem;
// @ts-expect-error migrated line pricing fields are required.
const missingLinePricing: OrderItemView = itemWithoutLinePayable;

const { pricingVersion: omittedPricingVersion, ...orderWithoutPricingVersion } =
  completeOrder;
// @ts-expect-error pricingVersion is required after the order pricing migration.
const missingPricingVersion: OrderView = orderWithoutPricingVersion;

const { payableTotalCents: omittedPayableTotal, ...orderWithoutPayableTotal } =
  completeOrder;
// @ts-expect-error migrated order amount fields are required.
const missingOrderPricing: OrderView = orderWithoutPayableTotal;

// @ts-expect-error membership snapshot fields must be present together.
const partialMembershipSnapshot: OrderView = {
  ...legacyOrder,
  membershipCode: 'GOLD',
};

void [
  validCreateOrder,
  invalidCreateOrder,
  completeItem,
  completeOrder,
  legacyOrder,
  omittedLinePayable,
  missingLinePricing,
  omittedPricingVersion,
  missingPricingVersion,
  omittedPayableTotal,
  missingOrderPricing,
  partialMembershipSnapshot,
];
