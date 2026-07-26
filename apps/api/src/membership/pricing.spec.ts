import { describe, expect, it } from 'vitest';

import { calculateMembershipPricing, calculatePricedLine } from './pricing.js';

describe('membership pricing', () => {
  it('keeps a one-cent line payable when its discount rounds down', () => {
    expect(calculatePricedLine(1, 1, 9_500)).toEqual({
      lineGoodsTotalCents: 1,
      lineMembershipDiscountCents: 0,
      linePayableCents: 1,
    });
  });

  it('rounds each discounted line to the nearest cent', () => {
    expect(calculatePricedLine(101, 1, 9_500)).toEqual({
      lineGoodsTotalCents: 101,
      lineMembershipDiscountCents: 5,
      linePayableCents: 96,
    });
    expect(calculatePricedLine(100, 1, 9_500)).toEqual({
      lineGoodsTotalCents: 100,
      lineMembershipDiscountCents: 5,
      linePayableCents: 95,
    });
  });

  it('caps requested credit by balance and the discounted total', () => {
    expect(
      calculateMembershipPricing(
        [
          { unitPriceCents: 1_000, quantity: 2 },
          { unitPriceCents: 500, quantity: 1 },
        ],
        9_000,
        3_000,
        1_200,
      ),
    ).toMatchObject({
      goodsTotalCents: 2_500,
      membershipDiscountCents: 250,
      discountedTotalCents: 2_250,
      creditAppliedCents: 1_200,
      payableTotalCents: 1_050,
    });
  });

  it('rejects unsafe or out-of-range monetary values', () => {
    expect(() => calculatePricedLine(4_294_967_295, 2, 9_500)).toThrow(
      'Money value exceeds the supported range',
    );
    expect(() => calculatePricedLine(100, 1, 10_001)).toThrow(
      'Discount basis points must be between 1000 and 10000',
    );
  });
});
