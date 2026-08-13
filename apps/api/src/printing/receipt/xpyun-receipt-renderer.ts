import { FulfillmentType } from '@bake-mall/contracts';
import iconv from 'iconv-lite';

import type { ReceiptPayload } from './receipt-payload.js';
import {
  alignColumns,
  truncateByDisplayWidth,
  wrapByDisplayWidth,
} from './text-layout.js';

const RECEIPT_WIDTH = 32;
const MAX_GBK_BYTES = 12 * 1024;
const TRUNCATED = '[已截断]';
const FLEXIBLE_FIELD_WIDTH = 5_000;
export const PRINT_PAYLOAD_TOO_LARGE = 'PRINT_PAYLOAD_TOO_LARGE';

const money = (cents: number): string => (cents / 100).toFixed(2);
const wrap = (text: string): readonly string[] =>
  wrapByDisplayWidth(text, RECEIPT_WIDTH);
const field = (label: string, value: string): readonly string[] =>
  wrap(`${label} ${value}`);
const multilineField = (label: string, value: string): readonly string[] => [
  label,
  ...wrap(value),
];

const render = (
  payload: ReceiptPayload,
  remarkWidth: number,
  addressWidth: number,
): string => {
  const lines: string[] = [
    ...wrap(payload.storeName),
    '-'.repeat(RECEIPT_WIDTH),
    ...field('订单号', payload.order.orderNo),
    ...field('下单时间', payload.order.orderedAt),
    `履约方式 ${
      payload.fulfillment.type === FulfillmentType.DELIVERY ? '配送' : '自提'
    }`,
    ...field(
      '顾客',
      `${payload.customer.name} ${payload.customer.phoneMasked}`,
    ),
  ];

  if (payload.fulfillment.type === FulfillmentType.DELIVERY) {
    lines.push(
      ...multilineField(
        '配送地址',
        truncateByDisplayWidth(
          payload.fulfillment.addressText,
          addressWidth,
          TRUNCATED,
        ),
      ),
    );
  } else if (payload.fulfillment.pickupTimeText) {
    lines.push(...field('自提时间', payload.fulfillment.pickupTimeText));
  }

  lines.push('-'.repeat(RECEIPT_WIDTH));
  for (const item of payload.items) {
    lines.push(
      ...wrap(item.productName),
      ...wrap(item.skuName),
      alignColumns(
        `${money(item.unitPriceCents)} x ${item.quantity}`,
        money(item.lineGoodsTotalCents),
        RECEIPT_WIDTH,
      ),
    );
  }
  lines.push(
    '-'.repeat(RECEIPT_WIDTH),
    alignColumns(
      '商品合计',
      money(payload.totals.goodsTotalCents),
      RECEIPT_WIDTH,
    ),
    alignColumns(
      '会员优惠',
      `-${money(payload.totals.membershipDiscountCents)}`,
      RECEIPT_WIDTH,
    ),
    alignColumns(
      '消费金抵扣',
      `-${money(payload.totals.creditAppliedCents)}`,
      RECEIPT_WIDTH,
    ),
    alignColumns(
      '应付金额',
      money(payload.totals.payableTotalCents),
      RECEIPT_WIDTH,
    ),
  );

  if (payload.remark) {
    lines.push(
      ...multilineField(
        '备注',
        truncateByDisplayWidth(payload.remark, remarkWidth, TRUNCATED),
      ),
    );
  }
  lines.push(
    '-'.repeat(RECEIPT_WIDTH),
    `打印次数 ${payload.print.sequence}`,
    ...field('打印时间', payload.print.printedAt),
    ...field('操作员', payload.print.operatorMasked),
  );
  return `${lines.join('\n')}\n`;
};

const byteLength = (text: string): number => iconv.encode(text, 'gbk').length;

export const renderXpyunReceipt = (payload: ReceiptPayload): string => {
  let rendered = render(payload, FLEXIBLE_FIELD_WIDTH, FLEXIBLE_FIELD_WIDTH);
  if (byteLength(rendered) <= MAX_GBK_BYTES) return rendered;

  rendered = render(payload, 32, FLEXIBLE_FIELD_WIDTH);
  if (byteLength(rendered) <= MAX_GBK_BYTES) return rendered;

  rendered = render(payload, 32, 32);
  if (byteLength(rendered) <= MAX_GBK_BYTES) return rendered;

  throw new Error(PRINT_PAYLOAD_TOO_LARGE);
};
