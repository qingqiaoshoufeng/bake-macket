import { FulfillmentType } from '@bake-mall/contracts';
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';

import type { ReceiptPayload } from './receipt-payload.js';
import {
  PRINT_PAYLOAD_TOO_LARGE,
  renderXpyunReceipt,
} from './xpyun-receipt-renderer.js';

const payload = (): ReceiptPayload => ({
  schemaVersion: 1,
  storeName: 'Bake Mall 幸福店',
  order: {
    id: '19',
    orderNo: 'BM202608110001',
    orderedAt: '2026-08-11T02:03:04.000Z',
  },
  customer: { name: '林女士', phoneMasked: '138****0000' },
  fulfillment: {
    type: FulfillmentType.DELIVERY,
    addressText: '幸福路 123 号 2 单元 301 室',
  },
  items: [
    {
      productName: '草莓奶油蛋糕',
      skuName: '六寸 / 少糖',
      skuAttributes: { size: '六寸', sweetness: '少糖' },
      unitPriceCents: 5_000,
      quantity: 2,
      lineGoodsTotalCents: 10_000,
      lineMembershipDiscountCents: 800,
      linePayableCents: 9_200,
    },
  ],
  totals: {
    goodsTotalCents: 10_000,
    membershipDiscountCents: 800,
    creditAppliedCents: 280,
    payableTotalCents: 8_920,
  },
  remark: '蛋糕写“生日快乐”[31m\n请提前十分钟联系',
  print: {
    sequence: 2,
    printedAt: '2026-08-11T03:04:05.000Z',
    operatorMasked: '管理员 #***42',
  },
});

const byteLength = (text: string): number => iconv.encode(text, 'gbk').length;

describe('renderXpyunReceipt', () => {
  it('输出固定 32 列纯文本、整数分金额和完整核心字段', () => {
    const rendered = renderXpyunReceipt(payload());

    expect(rendered).toContain('Bake Mall 幸福店');
    expect(rendered).toContain('订单号 BM202608110001');
    expect(rendered).toContain('配送');
    expect(rendered).toContain('138****0000');
    expect(rendered).not.toContain('13800000000');
    expect(rendered).toContain('草莓奶油蛋糕');
    expect(rendered).toContain('六寸 / 少糖');
    expect(rendered).toContain('商品合计');
    expect(rendered).toContain('100.00');
    expect(rendered).toContain('会员优惠');
    expect(rendered).toContain('-8.00');
    expect(rendered).toContain('消费金抵扣');
    expect(rendered).toContain('-2.80');
    expect(rendered).toContain('应付金额');
    expect(rendered).toContain('89.20');
    expect(rendered).toContain('打印次数 2');
    expect(rendered).not.toContain('');
    for (const line of rendered.split('\n')) {
      expect(
        [...line].reduce(
          (width, character) => width + (/^[ -~]$/u.test(character) ? 1 : 2),
          0,
        ),
      ).toBeLessThanOrEqual(32);
    }
    expect(byteLength(rendered)).toBeLessThanOrEqual(12 * 1024);
  });

  it('自提小票不输出配送地址', () => {
    const source = payload();
    const rendered = renderXpyunReceipt({
      ...source,
      fulfillment: {
        type: FulfillmentType.PICKUP,
        pickupTimeText: '2026-08-12 14:00-15:00',
      },
    });

    expect(rendered).toContain('自提');
    expect(rendered).toContain('2026-08-12 14:00-15:00');
    expect(rendered).not.toContain('幸福路');
  });

  it('超过 12 KiB 时先截断备注并保留地址、订单号和金额行', () => {
    const source = payload();
    const rendered = renderXpyunReceipt({
      ...source,
      remark: '超长备注'.repeat(5_000),
    });

    expect(byteLength(rendered)).toBeLessThanOrEqual(12 * 1024);
    expect(rendered).toContain('备注');
    expect(rendered).toContain('[已截断]');
    expect(rendered).toContain('幸福路 123 号 2 单元 301 室');
    expect(rendered).toContain(source.order.orderNo);
    expect(rendered).toContain('100.00');
    expect(rendered).toContain('89.20');
  });

  it('备注降级后仍超限则再截断地址且保留核心字段', () => {
    const source = payload();
    const rendered = renderXpyunReceipt({
      ...source,
      fulfillment: {
        type: FulfillmentType.DELIVERY,
        addressText: '超长配送地址'.repeat(5_000),
      },
      remark: '超长备注'.repeat(5_000),
    });

    expect(byteLength(rendered)).toBeLessThanOrEqual(12 * 1024);
    expect(rendered.match(/\[已截断\]/gu)).toHaveLength(2);
    expect(rendered).toContain(source.order.orderNo);
    expect(rendered).toContain('100.00');
    expect(rendered).toContain('89.20');
  });

  it('不可截断的订单号或金额核心内容本身无法容纳时确定性拒绝', () => {
    const source = payload();
    const oversizedItems = Array.from({ length: 1_500 }, (_, index) => ({
      ...source.items[0]!,
      productName: `商品-${index}`,
      skuName: '规格',
    }));

    expect(() =>
      renderXpyunReceipt({
        ...source,
        items: oversizedItems,
        fulfillment: { type: FulfillmentType.PICKUP },
        remark: null,
      }),
    ).toThrow(PRINT_PAYLOAD_TOO_LARGE);
  });
});
