import { describe, expect, it } from 'vitest';

import { yuanTextToCents } from './money.js';

describe('yuanTextToCents', () => {
  it.each([
    ['0', 0],
    ['0.01', 1],
    ['1.2', 120],
    ['12.34', 1234],
    [' 99.90 ', 9990],
  ])('converts %s to exact integer cents', (yuan, cents) => {
    expect(yuanTextToCents(yuan)).toBe(cents);
  });

  it.each(['', '.1', '1.', '1.001', '01', '-1', '1e2', 'NaN'])(
    'rejects invalid yuan text %s',
    (yuan) => {
      expect(() => yuanTextToCents(yuan)).toThrow();
    },
  );

  it('rejects values beyond unsigned integer cents', () => {
    expect(() => yuanTextToCents('42949672.96')).toThrow('金额超出允许范围');
  });
});
