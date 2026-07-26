import { describe, expect, it, vi } from 'vitest';

import { MembershipStatus, MembershipTheme } from '@bake-mall/contracts';

import { CartItem } from '../database/entities/cart-item.entity.js';
import { MemberAccount } from '../database/entities/member-account.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';
import { MembershipPricingService } from './membership-pricing.service.js';
import { OrderQuoteTokenService } from './order-quote-token.service.js';

const now = new Date('2026-07-22T08:00:00.000Z');
const tokenExpiresAt = 1_753_171_500;

const buildService = ({
  membership = null,
  account = null,
  quoteTokens = {
    issue: vi.fn().mockReturnValue({
      token: 'signed-quote',
      expiresAt: tokenExpiresAt,
    }),
  },
}: {
  membership?: UserMembership | null;
  account?: MemberAccount | null;
  quoteTokens?: Pick<OrderQuoteTokenService, 'issue'>;
} = {}) => {
  const cartItems = [
    { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 2 },
  ] as CartItem[];
  const skus = [
    {
      id: 'sku-1',
      productId: 'product-1',
      name: '6 寸',
      priceCents: 1_001,
      stock: 3,
      stockVersion: 5,
      isActive: true,
    },
  ] as Sku[];
  const products = [
    { id: 'product-1', name: '草莓奶油蛋糕', isActive: true },
  ] as Product[];
  const cartRepository = { find: vi.fn().mockResolvedValue(cartItems) };
  const skuRepository = { find: vi.fn().mockResolvedValue(skus) };
  const productRepository = { find: vi.fn().mockResolvedValue(products) };
  const accountRepository = { findOneBy: vi.fn().mockResolvedValue(account) };
  const membershipRepository = {
    findOneBy: vi.fn().mockResolvedValue(membership),
  };
  const service = new MembershipPricingService(
    cartRepository as never,
    skuRepository as never,
    productRepository as never,
    accountRepository as never,
    membershipRepository as never,
    quoteTokens as OrderQuoteTokenService,
    () => now,
  );
  return { service, quoteTokens };
};

const activeMembership = {
  id: 'membership-1',
  discountBasisPoints: 9_500,
  status: MembershipStatus.ACTIVE,
  startsAt: new Date('2026-07-01T00:00:00.000Z'),
  endsAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-22T07:30:00.000Z'),
  membershipLevelId: 'level-gold',
  levelCode: 'GOLD',
  levelName: '鎏金会员',
  levelRank: 20,
  benefits: [],
  theme: MembershipTheme.CHAMPAGNE,
  badgeText: 'GOLD',
} as unknown as UserMembership;

const account = {
  id: 'account-1',
  userId: 'user-1',
  activeMembershipId: 'membership-1',
  availableCreditCents: 500,
  version: 3,
} as MemberAccount;

describe('MembershipPricingService', () => {
  it('quotes each cart line using the active membership and binds all authority versions', async () => {
    const { service, quoteTokens } = buildService({
      membership: activeMembership,
      account,
    });

    await expect(
      service.quote('user-1', {
        cartItemIds: ['cart-1'],
        requestedCreditCents: 900,
      }),
    ).resolves.toMatchObject({
      goodsTotalCents: 2_002,
      membershipDiscountCents: 100,
      creditAppliedCents: 500,
      payableTotalCents: 1_402,
      quoteToken: 'signed-quote',
      expiresAt: new Date(tokenExpiresAt * 1_000).toISOString(),
      membership: { id: 'membership-1', code: 'GOLD' },
    });
    expect(quoteTokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        membershipId: 'membership-1',
        membershipVersion: '2026-07-22T07:30:00.000Z',
        accountVersion: 3,
        cart: [
          {
            cartItemId: 'cart-1',
            skuId: 'sku-1',
            quantity: 2,
            stockVersion: 5,
          },
        ],
      }),
    );
  });

  it('uses account credit without a discount when the pointed membership is expired', async () => {
    const expiredMembership = {
      ...activeMembership,
      endsAt: new Date('2026-07-22T07:59:59.000Z'),
    } as UserMembership;
    const { service, quoteTokens } = buildService({
      membership: expiredMembership,
      account,
    });

    await expect(
      service.quote('user-1', {
        cartItemIds: ['cart-1'],
        requestedCreditCents: 1_000,
      }),
    ).resolves.toMatchObject({
      goodsTotalCents: 2_002,
      membershipDiscountCents: 0,
      availableCreditCents: 500,
      maxCreditCents: 500,
      creditAppliedCents: 500,
      payableTotalCents: 1_502,
      membership: null,
    });
    expect(quoteTokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId: null,
        membershipVersion: null,
        accountVersion: 3,
      }),
    );
  });

  it('binds the version that a missing account will receive when order creation locks it', async () => {
    const { service, quoteTokens } = buildService();

    await service.quote('user-1', {
      cartItemIds: ['cart-1'],
      requestedCreditCents: 0,
    });

    expect(quoteTokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({ accountVersion: 1 }),
    );
  });

  it('uses the token issuer expiry as the single authority for the response', async () => {
    const quoteTokens = new OrderQuoteTokenService(
      'x'.repeat(32),
      300,
      () => 1_000,
    );
    const { service } = buildService({ quoteTokens });

    const quote = await service.quote('user-1', {
      cartItemIds: ['cart-1'],
      requestedCreditCents: 0,
    });
    const verified = quoteTokens.verify(quote.quoteToken, 'user-1');

    expect(verified.expiresAt).toBe(1_300);
    expect(Date.parse(quote.expiresAt)).toBe(verified.expiresAt * 1_000);
  });
});
