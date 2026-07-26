import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiErrorCode,
  MembershipStatus,
  type CurrentMembershipView,
  type OrderQuoteRequest,
  type OrderQuoteView,
} from '@bake-mall/contracts';
import { In, Repository } from 'typeorm';

import { CartItem } from '../database/entities/cart-item.entity.js';
import { MemberAccount } from '../database/entities/member-account.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';
import { OrderQuoteTokenService } from './order-quote-token.service.js';
import { calculateMembershipPricing } from './pricing.js';

export const MEMBERSHIP_CLOCK = Symbol('MEMBERSHIP_CLOCK');

@Injectable()
export class MembershipPricingService {
  constructor(
    @InjectRepository(CartItem)
    private readonly cartItems: Repository<CartItem>,
    @InjectRepository(Sku) private readonly skus: Repository<Sku>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(MemberAccount)
    private readonly accounts: Repository<MemberAccount>,
    @InjectRepository(UserMembership)
    private readonly memberships: Repository<UserMembership>,
    private readonly quoteTokens: OrderQuoteTokenService,
    @Optional()
    @Inject(MEMBERSHIP_CLOCK)
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async quote(
    userId: string,
    request: OrderQuoteRequest,
  ): Promise<OrderQuoteView> {
    const cartItems = await this.cartItems.find({
      where: { id: In(request.cartItemIds), userId },
    });
    if (cartItems.length !== request.cartItemIds.length) {
      throw new NotFoundException('购物车商品不存在');
    }
    const skuIds = [...new Set(cartItems.map(({ skuId }) => skuId))];
    const skus = await this.skus.find({ where: { id: In(skuIds) } });
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));
    const productIds = [...new Set(skus.map(({ productId }) => productId))];
    const products = await this.products.find({
      where: { id: In(productIds) },
    });
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );
    for (const item of cartItems) {
      const sku = skuById.get(item.skuId);
      const product = sku && productById.get(sku.productId);
      if (!sku?.isActive || !product?.isActive || sku.stock < item.quantity) {
        throw new ConflictException({
          code: ApiErrorCode.SKU_UNAVAILABLE,
          message: '购物车中存在不可购买商品',
        });
      }
    }

    const account = await this.accounts.findOneBy({ userId });
    const membership = account?.activeMembershipId
      ? await this.memberships.findOneBy({ id: account.activeMembershipId })
      : null;
    const currentMembership = this.isCurrentMembership(membership)
      ? membership
      : null;
    const pricing = calculateMembershipPricing(
      cartItems.map((item) => ({
        unitPriceCents: skuById.get(item.skuId)!.priceCents,
        quantity: item.quantity,
      })),
      currentMembership?.discountBasisPoints ?? 10_000,
      request.requestedCreditCents,
      account?.availableCreditCents ?? 0,
    );
    const lines = cartItems.map((item, index) => {
      const sku = skuById.get(item.skuId)!;
      const product = productById.get(sku.productId)!;
      return {
        cartItemId: item.id,
        productName: product.name,
        skuName: sku.name,
        quantity: item.quantity,
        unitPriceCents: sku.priceCents,
        ...pricing.lines[index],
      };
    });
    const issuedToken = this.quoteTokens.issue({
      userId,
      cart: cartItems.map((item) => ({
        cartItemId: item.id,
        skuId: item.skuId,
        quantity: item.quantity,
        stockVersion: skuById.get(item.skuId)!.stockVersion,
      })),
      requestedCreditCents: request.requestedCreditCents,
      membershipId: currentMembership?.id ?? null,
      membershipVersion: currentMembership?.updatedAt.toISOString() ?? null,
      accountVersion: account?.version ?? 1,
      pricingVersion: 1,
    });
    return {
      lines,
      goodsTotalCents: pricing.goodsTotalCents,
      membershipDiscountCents: pricing.membershipDiscountCents,
      discountedTotalCents: pricing.discountedTotalCents,
      requestedCreditCents: pricing.requestedCreditCents,
      creditAppliedCents: pricing.creditAppliedCents,
      payableTotalCents: pricing.payableTotalCents,
      availableCreditCents: account?.availableCreditCents ?? 0,
      maxCreditCents: Math.min(
        account?.availableCreditCents ?? 0,
        pricing.discountedTotalCents,
      ),
      membership: currentMembership
        ? this.toCurrentMembershipView(currentMembership)
        : null,
      quoteToken: issuedToken.token,
      expiresAt: new Date(issuedToken.expiresAt * 1_000).toISOString(),
    };
  }

  private isCurrentMembership(
    membership: UserMembership | null,
  ): membership is UserMembership {
    const now = this.clock();
    return Boolean(
      membership &&
      membership.status === MembershipStatus.ACTIVE &&
      membership.startsAt <= now &&
      membership.endsAt > now,
    );
  }

  private toCurrentMembershipView(
    membership: UserMembership,
  ): CurrentMembershipView {
    return {
      id: membership.id,
      levelId: membership.membershipLevelId,
      code: membership.levelCode,
      name: membership.levelName,
      rank: membership.levelRank,
      discountBasisPoints: membership.discountBasisPoints,
      startsAt: membership.startsAt.toISOString(),
      endsAt: membership.endsAt.toISOString(),
      status: membership.status,
      cardTheme: { theme: membership.theme, badgeText: membership.badgeText },
      benefits: membership.benefits,
    };
  }
}
