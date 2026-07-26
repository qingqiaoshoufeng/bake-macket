import { describe, expect, it } from 'vitest';

import { OrderQuoteTokenService } from './order-quote-token.service.js';

const payload = {
  userId: 'user-1',
  cart: [
    {
      cartItemId: 'cart-1',
      skuId: 'sku-1',
      quantity: 2,
      stockVersion: 3,
    },
  ],
  requestedCreditCents: 500,
  membershipId: 'membership-1',
  membershipVersion: '2026-07-22T07:30:00.000Z',
  accountVersion: 4,
  pricingVersion: 1,
};

describe('OrderQuoteTokenService', () => {
  it('issues an authoritative integer expiry and round-trips every bound version', () => {
    const service = new OrderQuoteTokenService(
      'x'.repeat(32),
      300,
      () => 1_000,
    );
    const issued = service.issue(payload);

    expect(issued.expiresAt).toBe(1_300);
    expect(Number.isInteger(issued.expiresAt)).toBe(true);
    expect(service.verify(issued.token, 'user-1')).toEqual({
      ...payload,
      expiresAt: issued.expiresAt,
    });
  });

  it('normalizes the issuer clock to integer seconds', () => {
    const service = new OrderQuoteTokenService(
      'x'.repeat(32),
      300,
      () => 1_000.75,
    );

    expect(service.issue(payload).expiresAt).toBe(1_300);
  });

  it('rejects tampering, another user, and expired quotes', () => {
    const service = new OrderQuoteTokenService('x'.repeat(32), 10, () => 1_000);
    const { token, expiresAt } = service.issue(payload);

    expect(() => service.verify(`${token}x`, 'user-1')).toThrow(
      'Order quote is stale',
    );
    expect(() => service.verify(token, 'user-2')).toThrow(
      'Order quote is stale',
    );

    const expiredService = new OrderQuoteTokenService(
      'x'.repeat(32),
      10,
      () => expiresAt + 1,
    );
    expect(() => expiredService.verify(token, 'user-1')).toThrow(
      'Order quote is stale',
    );
  });

  it('requires a sufficiently long signing secret', () => {
    expect(() => new OrderQuoteTokenService('short', 300)).toThrow(
      'Order quote token secret must contain at least 32 characters',
    );
  });
});
