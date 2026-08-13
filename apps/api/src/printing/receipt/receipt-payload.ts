import { FulfillmentType, OrderStatus } from '@bake-mall/contracts';

export type ReceiptOrderSnapshot = Readonly<{
  id: string;
  orderNo: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  contactName: string;
  contactPhone: string;
  pickupTimeText: string | null;
  deliveryAddressText: string | null;
  goodsTotalCents: number;
  membershipDiscountCents: number;
  creditAppliedCents: number;
  payableTotalCents: number;
  membershipCode: string | null;
  membershipName: string | null;
  membershipDiscountBasisPoints: number | null;
  pricingVersion: number;
  remark: string | null;
  createdAt: Date;
}>;

export type ReceiptOrderItemSnapshot = Readonly<{
  id: string;
  orderId: string;
  productId: string | null;
  skuId: string | null;
  productName: string;
  skuName: string;
  skuAttributes: Readonly<Record<string, string>>;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  lineGoodsTotalCents: number;
  lineMembershipDiscountCents: number;
  linePayableCents: number;
}>;

export type ReceiptBuildContext = Readonly<{
  storeName: string;
  printSequence: number;
  printedAt: Date;
  operatorMasked: string;
}>;

export type ReceiptLineItem = Readonly<{
  productName: string;
  skuName: string;
  skuAttributes: Readonly<Record<string, string>>;
  unitPriceCents: number;
  quantity: number;
  lineGoodsTotalCents: number;
  lineMembershipDiscountCents: number;
  linePayableCents: number;
}>;

export type ReceiptPayload = Readonly<{
  schemaVersion: 1;
  storeName: string;
  order: Readonly<{ id: string; orderNo: string; orderedAt: string }>;
  customer: Readonly<{ name: string; phoneMasked: string }>;
  fulfillment:
    | Readonly<{ type: FulfillmentType.PICKUP; pickupTimeText?: string }>
    | Readonly<{
        type: FulfillmentType.DELIVERY;
        addressText: string;
      }>;
  items: readonly ReceiptLineItem[];
  totals: Readonly<{
    goodsTotalCents: number;
    membershipDiscountCents: number;
    creditAppliedCents: number;
    payableTotalCents: number;
  }>;
  remark: string | null;
  print: Readonly<{
    sequence: number;
    printedAt: string;
    operatorMasked: string;
  }>;
}>;

const assertNonNegativeInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
};

const maskPhone = (phone: string): string => {
  if (phone.length < 7) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
};

const buildFulfillment = (
  order: ReceiptOrderSnapshot,
): ReceiptPayload['fulfillment'] => {
  if (order.fulfillmentType === FulfillmentType.DELIVERY) {
    if (!order.deliveryAddressText?.trim()) {
      throw new Error('配送订单缺少 address 快照');
    }
    return {
      type: FulfillmentType.DELIVERY,
      addressText: order.deliveryAddressText,
    };
  }
  return {
    type: FulfillmentType.PICKUP,
    ...(order.pickupTimeText ? { pickupTimeText: order.pickupTimeText } : {}),
  };
};

export const buildReceiptPayload = (
  order: ReceiptOrderSnapshot,
  items: readonly ReceiptOrderItemSnapshot[],
  context: ReceiptBuildContext,
): ReceiptPayload => {
  if (order.status === OrderStatus.CANCELLED) {
    throw new Error('cancelled order cannot be printed（取消订单不可打印）');
  }
  if (items.length === 0) throw new Error('receipt requires at least one item');
  for (const field of [
    'goodsTotalCents',
    'membershipDiscountCents',
    'creditAppliedCents',
    'payableTotalCents',
  ] as const) {
    assertNonNegativeInteger(order[field], field);
  }
  if (
    order.payableTotalCents !==
    order.goodsTotalCents -
      order.membershipDiscountCents -
      order.creditAppliedCents
  ) {
    throw new Error('order total 金额不守恒');
  }
  if (
    !Number.isSafeInteger(context.printSequence) ||
    context.printSequence < 1
  ) {
    throw new Error('printSequence must be a positive integer');
  }

  const receiptItems = items.map((item): ReceiptLineItem => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new Error('item quantity must be a positive integer');
    }
    for (const field of [
      'unitPriceCents',
      'lineGoodsTotalCents',
      'lineMembershipDiscountCents',
      'linePayableCents',
    ] as const) {
      assertNonNegativeInteger(item[field], field);
    }
    if (
      item.lineGoodsTotalCents !== item.unitPriceCents * item.quantity ||
      item.linePayableCents !==
        item.lineGoodsTotalCents - item.lineMembershipDiscountCents
    ) {
      throw new Error('item total 金额不守恒');
    }
    return {
      productName: item.productName,
      skuName: item.skuName,
      skuAttributes: { ...item.skuAttributes },
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      lineGoodsTotalCents: item.lineGoodsTotalCents,
      lineMembershipDiscountCents: item.lineMembershipDiscountCents,
      linePayableCents: item.linePayableCents,
    };
  });
  const itemTotals = receiptItems.reduce(
    (totals, item) => ({
      goods: totals.goods + item.lineGoodsTotalCents,
      membershipDiscount:
        totals.membershipDiscount + item.lineMembershipDiscountCents,
      payable: totals.payable + item.linePayableCents,
    }),
    { goods: 0, membershipDiscount: 0, payable: 0 },
  );
  if (
    itemTotals.goods !== order.goodsTotalCents ||
    itemTotals.membershipDiscount !== order.membershipDiscountCents ||
    itemTotals.payable - order.creditAppliedCents !== order.payableTotalCents
  ) {
    throw new Error('item/order aggregate 金额不守恒');
  }

  return {
    schemaVersion: 1,
    storeName: context.storeName,
    order: {
      id: order.id,
      orderNo: order.orderNo,
      orderedAt: order.createdAt.toISOString(),
    },
    customer: {
      name: order.contactName,
      phoneMasked: maskPhone(order.contactPhone),
    },
    fulfillment: buildFulfillment(order),
    items: receiptItems,
    totals: {
      goodsTotalCents: order.goodsTotalCents,
      membershipDiscountCents: order.membershipDiscountCents,
      creditAppliedCents: order.creditAppliedCents,
      payableTotalCents: order.payableTotalCents,
    },
    remark: order.remark,
    print: {
      sequence: context.printSequence,
      printedAt: context.printedAt.toISOString(),
      operatorMasked: context.operatorMasked,
    },
  };
};
