import { createHmac, timingSafeEqual } from 'node:crypto';

import { ApiErrorCode } from '@bake-mall/contracts';
import { ConflictException } from '@nestjs/common';

export type OrderQuoteTokenPayload = {
  userId: string;
  cart: Array<{
    cartItemId: string;
    quantity: number;
    stockVersion: number;
  }>;
  requestedCreditCents: number;
  membershipId: string | null;
  accountVersion: number | null;
  pricingVersion: number;
};

type SignedOrderQuoteTokenPayload = OrderQuoteTokenPayload & {
  expiresAt: number;
};

export class OrderQuoteTokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
    private readonly nowSeconds: () => number = () =>
      Math.floor(Date.now() / 1_000),
  ) {
    if (secret.length < 32) {
      throw new Error(
        'Order quote token secret must contain at least 32 characters',
      );
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error('Order quote TTL must be a positive integer');
    }
  }

  issue(payload: OrderQuoteTokenPayload): string {
    const encodedPayload = Buffer.from(
      JSON.stringify({
        ...payload,
        expiresAt: this.nowSeconds() + this.ttlSeconds,
      } satisfies SignedOrderQuoteTokenPayload),
    ).toString('base64url');
    return `${encodedPayload}.${this.sign(encodedPayload)}`;
  }

  verify(token: string, expectedUserId: string): SignedOrderQuoteTokenPayload {
    const [encodedPayload, signature, extra] = token.split('.');
    if (!encodedPayload || !signature || extra) return this.rejectStale();
    const expectedSignature = this.sign(encodedPayload);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return this.rejectStale();
    }

    try {
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as SignedOrderQuoteTokenPayload;
      if (
        payload.userId !== expectedUserId ||
        !Number.isInteger(payload.expiresAt) ||
        payload.expiresAt <= this.nowSeconds()
      ) {
        return this.rejectStale();
      }
      return payload;
    } catch {
      return this.rejectStale();
    }
  }

  private sign(encodedPayload: string): string {
    return createHmac('sha256', this.secret)
      .update(encodedPayload)
      .digest('base64url');
  }

  private rejectStale(): never {
    throw new ConflictException({
      code: ApiErrorCode.ORDER_QUOTE_STALE,
      message: 'Order quote is stale',
    });
  }
}
