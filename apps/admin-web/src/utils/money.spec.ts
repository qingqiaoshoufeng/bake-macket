import { describe, expect, it } from 'vitest';

import {
  basisPointsToDiscountText,
  centsToYuanText,
  discountTextToBasisPoints,
  yuanTextToCents,
} from './money.js';

describe('精确金额字符串转换', () => {
  it.each([
    ['0', 0],
    ['0.01', 1],
    ['12.3', 1230],
    ['199.00', 19900],
    ['42949672.95', 4294967295],
  ])('将 %s 元精确转换为 %i 分', (yuan, cents) => {
    expect(yuanTextToCents(yuan)).toBe(cents);
    expect(centsToYuanText(cents)).toBe(
      cents === 4294967295 ? '42949672.95' : Number(yuan).toFixed(2),
    );
  });

  it.each(['', '-1', '1.', '.1', '1.001', '1e2', '42949672.96'])(
    '拒绝非法或越界金额 %s',
    (yuan) => {
      expect(() => yuanTextToCents(yuan)).toThrow();
    },
  );
});

describe('精确折扣字符串转换', () => {
  it.each([
    ['1', 1000, '1.0'],
    ['1.000', 1000, '1.0'],
    ['8.8', 8800, '8.8'],
    ['9.55', 9550, '9.55'],
    ['9.550', 9550, '9.55'],
    ['9.555', 9555, '9.555'],
    ['10', 10000, '10.0'],
    ['10.000', 10000, '10.0'],
  ])('将 %s 折精确转换为 %i basis points', (text, points, displayed) => {
    expect(discountTextToBasisPoints(text)).toBe(points);
    expect(basisPointsToDiscountText(points)).toBe(displayed);
    expect(discountTextToBasisPoints(displayed)).toBe(points);
  });

  it.each(['', '0.999', '10.001', '8.8888', '8e0'])(
    '拒绝非法折扣 %s',
    (text) => {
      expect(() => discountTextToBasisPoints(text)).toThrow();
    },
  );

  it.each([999, 10_001, 9_555.5, Number.NaN])(
    '拒绝非法或越界折扣基点 %s',
    (points) => {
      expect(() => basisPointsToDiscountText(points)).toThrow();
    },
  );
});
