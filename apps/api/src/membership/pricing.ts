const MAX_UNSIGNED_INT = 4_294_967_295;
const MIN_DISCOUNT_BASIS_POINTS = 1_000;
const MAX_DISCOUNT_BASIS_POINTS = 10_000;

export type PricingLineInput = {
  unitPriceCents: number;
  quantity: number;
};

export type PricedLine = {
  lineGoodsTotalCents: number;
  lineMembershipDiscountCents: number;
  linePayableCents: number;
};

export type MembershipPricing = {
  lines: PricedLine[];
  goodsTotalCents: number;
  membershipDiscountCents: number;
  discountedTotalCents: number;
  requestedCreditCents: number;
  creditAppliedCents: number;
  payableTotalCents: number;
};

function assertUnsignedInt(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UNSIGNED_INT) {
    throw new RangeError('Money value exceeds the supported range');
  }
}

function sumMoney(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  assertUnsignedInt(total);
  return total;
}

export function calculatePricedLine(
  unitPriceCents: number,
  quantity: number,
  discountBasisPoints: number,
): PricedLine {
  assertUnsignedInt(unitPriceCents);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError('Quantity must be a positive integer');
  }
  if (
    !Number.isInteger(discountBasisPoints) ||
    discountBasisPoints < MIN_DISCOUNT_BASIS_POINTS ||
    discountBasisPoints > MAX_DISCOUNT_BASIS_POINTS
  ) {
    throw new RangeError(
      'Discount basis points must be between 1000 and 10000',
    );
  }

  const lineGoodsTotalCents = unitPriceCents * quantity;
  assertUnsignedInt(lineGoodsTotalCents);
  const discountedNumerator =
    lineGoodsTotalCents * discountBasisPoints + MAX_DISCOUNT_BASIS_POINTS / 2;
  if (!Number.isSafeInteger(discountedNumerator)) {
    throw new RangeError('Money value exceeds the supported range');
  }
  const linePayableCents = Math.floor(
    discountedNumerator / MAX_DISCOUNT_BASIS_POINTS,
  );
  assertUnsignedInt(linePayableCents);
  return {
    lineGoodsTotalCents,
    lineMembershipDiscountCents: lineGoodsTotalCents - linePayableCents,
    linePayableCents,
  };
}

export function calculateMembershipPricing(
  lineInputs: readonly PricingLineInput[],
  discountBasisPoints: number,
  requestedCreditCents: number,
  availableCreditCents: number,
): MembershipPricing {
  assertUnsignedInt(requestedCreditCents);
  assertUnsignedInt(availableCreditCents);
  const lines = lineInputs.map(({ unitPriceCents, quantity }) =>
    calculatePricedLine(unitPriceCents, quantity, discountBasisPoints),
  );
  const goodsTotalCents = sumMoney(
    lines.map(({ lineGoodsTotalCents }) => lineGoodsTotalCents),
  );
  const discountedTotalCents = sumMoney(
    lines.map(({ linePayableCents }) => linePayableCents),
  );
  const membershipDiscountCents = goodsTotalCents - discountedTotalCents;
  const creditAppliedCents = Math.min(
    requestedCreditCents,
    availableCreditCents,
    discountedTotalCents,
  );
  return {
    lines,
    goodsTotalCents,
    membershipDiscountCents,
    discountedTotalCents,
    requestedCreditCents,
    creditAppliedCents,
    payableTotalCents: discountedTotalCents - creditAppliedCents,
  };
}
