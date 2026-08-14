import { FulfillmentType, OrderStatus } from '@bake-mall/contracts';
import { describe, expect, it } from 'vitest';

import { buildReceiptPayload } from './receipt-payload.js';

const order = () => ({
  id: '19',
  orderNo: 'BM202608110001',
  status: OrderStatus.PROCESSING,
  fulfillmentType: FulfillmentType.DELIVERY,
  contactName: '林女士',
  contactPhone: '13800000000',
  pickupTimeText: null,
  deliveryAddressText: '幸福路 123 号 2 单元 301 室',
  goodsTotalCents: 10_000,
  membershipDiscountCents: 800,
  creditAppliedCents: 280,
  payableTotalCents: 8_920,
  membershipCode: 'GOLD',
  membershipName: '金卡会员',
  membershipDiscountBasisPoints: 9_200,
  pricingVersion: 3,
  remark: '蛋糕写“生日快乐”[31m\n请提前十分钟联系',
  createdAt: new Date('2026-08-11T02:03:04.000Z'),
});

const items = () => [
  {
    id: '51',
    orderId: '19',
    productId: '7',
    skuId: '9',
    productName: '草莓奶油蛋糕',
    skuName: '六寸 / 少糖',
    skuAttributes: { size: '六寸', sweetness: '少糖' },
    imageUrl: 'https://example.invalid/current-image.jpg',
    unitPriceCents: 5_000,
    quantity: 2,
    lineGoodsTotalCents: 10_000,
    lineMembershipDiscountCents: 800,
    linePayableCents: 9_200,
  },
];

const context = {
  storeName: 'Bake Mall 幸福店',
  printSequence: 2,
  printedAt: new Date('2026-08-11T03:04:05.000Z'),
  operatorMasked: '管理员 #***42',
};

describe('buildReceiptPayload', () => {
  it('只从订单不可变快照构造配送小票并脱敏手机号', () => {
    const sourceOrder = order();
    const sourceItems = items();

    const payload = buildReceiptPayload(sourceOrder, sourceItems, context);

    expect(payload.customer).toEqual({
      name: '林女士',
      phoneMasked: '138****0000',
    });
    expect(payload.fulfillment).toEqual({
      type: FulfillmentType.DELIVERY,
      addressText: sourceOrder.deliveryAddressText,
    });
    expect(payload.items[0]).toMatchObject({
      productName: '草莓奶油蛋糕',
      skuName: '六寸 / 少糖',
      skuAttributes: { size: '六寸', sweetness: '少糖' },
      unitPriceCents: 5_000,
      quantity: 2,
      lineGoodsTotalCents: 10_000,
    });
    expect(payload.totals).toEqual({
      goodsTotalCents: 10_000,
      membershipDiscountCents: 800,
      creditAppliedCents: 280,
      payableTotalCents: 8_920,
    });
    expect(payload.print).toEqual({
      sequence: 2,
      printedAt: '2026-08-11T03:04:05.000Z',
      operatorMasked: '管理员 #***42',
    });
    expect(JSON.stringify(payload)).not.toContain('13800000000');
    expect(JSON.stringify(payload)).not.toContain('https://example.invalid');

    sourceOrder.contactName = '实时用户名称';
    sourceItems[0]!.productName = '实时商品名称';
    sourceItems[0]!.skuAttributes.size = '实时规格';
    expect(payload.customer.name).toBe('林女士');
    expect(payload.items[0]!.productName).toBe('草莓奶油蛋糕');
    expect(payload.items[0]!.skuAttributes.size).toBe('六寸');
  });

  it('自提 payload 保留自提时间且不携带配送地址', () => {
    const sourceOrder = {
      ...order(),
      fulfillmentType: FulfillmentType.PICKUP,
      pickupTimeText: '2026-08-12 14:00-15:00',
      deliveryAddressText: null,
    };

    const payload = buildReceiptPayload(sourceOrder, items(), context);

    expect(payload.fulfillment).toEqual({
      type: FulfillmentType.PICKUP,
      pickupTimeText: '2026-08-12 14:00-15:00',
    });
    expect(JSON.stringify(payload.fulfillment)).not.toContain('address');
  });

  it('拒绝已取消订单及不完整的配送快照', () => {
    expect(() =>
      buildReceiptPayload(
        { ...order(), status: OrderStatus.CANCELLED },
        items(),
        context,
      ),
    ).toThrow(/cancelled|取消/iu);
    expect(() =>
      buildReceiptPayload(
        { ...order(), deliveryAddressText: null },
        items(),
        context,
      ),
    ).toThrow(/address|地址/iu);
  });

  it('拒绝不守恒金额、非正数量和无订单项的损坏快照', () => {
    expect(() =>
      buildReceiptPayload(
        { ...order(), payableTotalCents: 8_919 },
        items(),
        context,
      ),
    ).toThrow(/total|金额|守恒/iu);
    expect(() =>
      buildReceiptPayload(order(), [{ ...items()[0]!, quantity: 0 }], context),
    ).toThrow(/quantity|数量/iu);
    expect(() => buildReceiptPayload(order(), [], context)).toThrow(
      /item|商品/iu,
    );
    expect(() =>
      buildReceiptPayload(
        order(),
        [{ ...items()[0]!, lineMembershipDiscountCents: 799 }],
        context,
      ),
    ).toThrow(/item|order|aggregate|金额|守恒/iu);
  });
});
