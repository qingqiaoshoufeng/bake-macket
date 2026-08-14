import { describe, expect, it } from 'vitest';

import { hashPrintPayload } from './payload-hash.js';

describe('hashPrintPayload', () => {
  it('对结构相同且 object key 顺序不同的 payload 生成相同 SHA-256', () => {
    const left = {
      schemaVersion: 1,
      order: { id: '19', orderNo: 'BM202608110001' },
      totals: { goodsTotalCents: 10_000, payableTotalCents: 8_920 },
    };
    const right = {
      totals: { payableTotalCents: 8_920, goodsTotalCents: 10_000 },
      order: { orderNo: 'BM202608110001', id: '19' },
      schemaVersion: 1,
    };

    expect(hashPrintPayload(left)).toBe(hashPrintPayload(right));
    expect(hashPrintPayload(left)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('数组顺序或业务值变化时 hash 不同', () => {
    expect(hashPrintPayload({ items: ['a', 'b'] })).not.toBe(
      hashPrintPayload({ items: ['b', 'a'] }),
    );
    expect(hashPrintPayload({ payableTotalCents: 8_920 })).not.toBe(
      hashPrintPayload({ payableTotalCents: 8_921 }),
    );
  });

  it.each([
    { label: 'undefined', value: { unsupported: undefined } },
    { label: 'non-finite', value: { unsupported: Number.NaN } },
    { label: 'date', value: { unsupported: new Date() } },
    {
      label: 'symbol-key',
      value: Object.assign(
        { supported: true },
        { [Symbol('hidden')]: 'secret' },
      ),
    },
    {
      label: 'non-enumerable',
      value: Object.defineProperty({ supported: true }, 'hidden', {
        enumerable: false,
        value: 'secret',
      }),
    },
  ])('拒绝 $label 非 canonical JSON 值', ({ value }) => {
    expect(() => hashPrintPayload(value)).toThrow(
      /canonical|JSON|unsupported/iu,
    );
  });
});
