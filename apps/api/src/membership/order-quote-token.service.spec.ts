import { describe, expect, it } from 'vitest';

import { OrderQuoteTokenService } from './order-quote-token.service.js';

const payload = {
  userId: 'user-1',
  cart: [{ cartItemId: 'cart-1', quantity: 2, stockVersion: 3 }],
  requestedCreditCents: 500,
  membershipId: 'membership-1',
  accountVersion: 4,
  pricingVersion: 1,
};

describe('OrderQuoteTokenService', () => {
  it('round-trips a signed quote for the expected user', () => {
    const service = new OrderQuoteTokenService(
      'x'.repeat(32),
      300,
      () => 1_000,
    );
    const token = service.issue(payload);

    expect(service.verify(token, 'user-1')).toMatchObject(payload);
  });

  it('rejects tampering, another user, and expired quotes', () => {
    const service = new OrderQuoteTokenService('x'.repeat(32), 10, () => 1_000);
    const token = service.issue(payload);

    expect(() => service.verify(`${token}x`, 'user-1')).toThrow(
      'Order quote is stale',
    );
    expect(() => service.verify(token, 'user-2')).toThrow(
      'Order quote is stale',
    );

    const expiredService = new OrderQuoteTokenService(
      'x'.repeat(32),
      10,
      () => 1_011,
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
