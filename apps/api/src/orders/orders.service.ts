import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  ApiErrorCode,
  canTransitionOrder,
  FulfillmentType,
  MemberCreditDirection,
  MemberCreditEntryType,
  MembershipStatus,
  OrderStatus,
  type AdminOrderListItem,
  type AdminOrderListQuery,
  type AdminOrderListResult,
  type OrderStatusUpdateResult,
  type OrderView,
} from '@bake-mall/contracts';
import { randomInt } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { Address } from '../database/entities/address.entity.js';
import { CartItem } from '../database/entities/cart-item.entity.js';
import { MemberAccount } from '../database/entities/member-account.entity.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { MemberCreditEntry } from '../database/entities/member-credit-entry.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { OrderItem } from '../database/entities/order-item.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';
import { User } from '../database/entities/user.entity.js';
import { MembershipCreditService } from '../membership/membership-credit.service.js';
import {
  type OrderQuoteTokenPayload,
  OrderQuoteTokenService,
} from '../membership/order-quote-token.service.js';
import { calculateMembershipPricing } from '../membership/pricing.js';
import { applyOrderHeaderFilters } from './admin-order-query.helpers.js';
import { CreateOrderDto } from './dto/create-order.dto.js';

const PRODUCT_ORDER_CREATE = 'PRODUCT_ORDER_CREATE';
const ORDER_RESOURCE_TYPE = 'ORDER';
const ORDER_PRICING_VERSION = 1;

type OrderItemAggregateRow = {
  orderId: string;
  itemLineCount: string;
  totalQuantity: string;
};

type OrderItemAggregate = {
  itemLineCount: number;
  totalQuantity: number;
};

/**
 * Order lifecycle service. Wraps every mutation that touches stock, the
 * idempotency table, the order header, the immutable item snapshots, the
 * fulfilment text, and the cart cleanup. Each public method is the only
 * sanctioned entry point for its domain concern; controllers are thin
 * adapters around these calls.
 *
 * Stock decrements use a single conditional `UPDATE ... WHERE stock >= qty
 * AND is_active = true` and inspect `affected`. If `affected !== 1` the
 * service rolls the entire transaction back, leaving no order, no cart
 * cleanup, and no partial stock loss. The conditional predicate is the
 * authoritative guard against overselling.
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItems: Repository<OrderItem>,
    @InjectRepository(CartItem)
    private readonly cartItems: Repository<CartItem>,
    @InjectRepository(Sku) private readonly skus: Repository<Sku>,
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly audit: AuditService,
    private readonly quoteTokens: OrderQuoteTokenService,
    private readonly credit: MembershipCreditService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * Create a new order inside a single MySQL transaction. Steps:
   *
   * 1. Validate the user has a verified phone (pre-condition for ordering).
   * 2. Load and validate the requested cart items belong to this user, point
   *    to live, active SKUs with enough stock, and include product metadata
   *    needed for the immutable item snapshots.
   * 3. Reserve the (user, idempotency key) pair inside the transaction. If
   *    a prior call already produced an order with this key, return that
   *    order. If the prior call is still in flight (no `orderId` yet),
   *    return 409 so the client can retry safely.
   * 4. Conditionally decrement each SKU. Any failed decrement triggers a
   *    full rollback and a `STOCK_INSUFFICIENT` error.
   * 5. Persist the order header, immutable order items with the captured
   *    product/SKU/price snapshot, the delivery address snapshot (when
   *    applicable), the pickup time text, and remove the source cart items.
   * 6. Stamp the idempotency record with the produced order id so retries
   *    resolve to the original response.
   */
  async create(
    userId: string,
    idempotencyKey: string,
    dto: CreateOrderDto,
  ): Promise<OrderView> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const user = await this.users.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.phone || !user.phoneVerified) {
      throw new ForbiddenException({
        code: ApiErrorCode.PHONE_REQUIRED,
        message: 'A verified phone number is required before placing an order.',
      });
    }

    if (!dto.cartItemIds?.length) {
      throw new BadRequestException('cartItemIds must not be empty');
    }
    if (new Set(dto.cartItemIds).size !== dto.cartItemIds.length) {
      throw OrdersService.orderQuoteStale();
    }

    const requestHash = this.idempotencyService.hashRequest(
      OrdersService.semanticCreateRequest(dto),
    );
    const idempotencyInput = {
      userId,
      operation: PRODUCT_ORDER_CREATE,
      key: idempotencyKey,
      requestHash,
      resourceType: ORDER_RESOURCE_TYPE,
      snapshotGuard: OrdersService.isOrderViewSnapshot,
    };

    // A completed replay must not depend on cart or order rows still existing.
    const replay = await this.idempotencyService.findReplay(idempotencyInput);
    if (replay) return replay;

    const quotePayload = this.validateQuoteIntent(userId, dto);

    // Resolve the address snapshot for delivery fulfillment up front so the
    // transaction can capture a fully populated snapshot without re-querying.
    let deliveryAddressSnapshot: string | null = null;
    if (dto.fulfillmentType === FulfillmentType.DELIVERY) {
      if (!dto.addressId) {
        throw new BadRequestException(
          'addressId is required for DELIVERY fulfillment.',
        );
      }
      const address = await this.addresses.findOne({
        where: { id: dto.addressId, userId },
      });
      if (!address) {
        throw new NotFoundException('Delivery address not found');
      }
      deliveryAddressSnapshot = OrdersService.formatAddress(address);
    } else if (!dto.pickupTimeText?.trim()) {
      throw new BadRequestException(
        'pickupTimeText is required for PICKUP fulfillment.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(Order);
      const orderItemRepo = manager.getRepository(OrderItem);
      const cartRepo = manager.getRepository(CartItem);
      const skuRepo = manager.getRepository(Sku);
      const productRepo = manager.getRepository(Product);
      const userRepo = manager.getRepository(User);
      const membershipRepo = manager.getRepository(UserMembership);

      const lockedUser = await userRepo.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedUser) throw new NotFoundException('User not found');
      if (!lockedUser.phone || !lockedUser.phoneVerified) {
        throw new ForbiddenException({
          code: ApiErrorCode.PHONE_REQUIRED,
          message:
            'A verified phone number is required before placing an order.',
        });
      }

      const racedReplay = await this.idempotencyService.reserve(
        manager,
        idempotencyInput,
      );
      if (racedReplay) return racedReplay;

      const lockedAccount = await this.credit.lockOrCreateAccount(
        manager,
        userId,
      );
      const lockedMembership = lockedAccount?.activeMembershipId
        ? await membershipRepo.findOne({
            where: { id: lockedAccount.activeMembershipId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      const currentMembership = OrdersService.isCurrentMembership(
        lockedMembership,
        new Date(),
      )
        ? lockedMembership
        : null;
      const cartRecords = await dto.cartItemIds
        .toSorted((left, right) => left.localeCompare(right))
        .reduce(
          async (pending, cartItemId) => {
            const collected = await pending;
            const cartItem = await cartRepo.findOne({
              where: { id: cartItemId, userId },
              lock: { mode: 'pessimistic_write' },
            });
            if (!cartItem) throw new NotFoundException('Cart item not found');
            return [...collected, cartItem];
          },
          Promise.resolve([] as CartItem[]),
        );
      const skuIds = [...new Set(cartRecords.map(({ skuId }) => skuId))].sort(
        (left, right) => left.localeCompare(right),
      );
      const skuRecords = await skuIds.reduce(
        async (pending, skuId) => {
          const collected = await pending;
          const sku = await skuRepo.findOne({
            where: { id: skuId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!sku) throw OrdersService.skuUnavailable(skuId);
          return [...collected, sku];
        },
        Promise.resolve([] as Sku[]),
      );
      const skuById = new Map(skuRecords.map((sku) => [sku.id, sku]));
      this.assertQuoteVersions(
        quotePayload,
        cartRecords,
        skuById,
        currentMembership,
        lockedAccount,
      );
      const productIds = [
        ...new Set(skuRecords.map(({ productId }) => productId)),
      ];
      const productRecords = await productRepo.find({
        where: { id: In(productIds) },
      });
      const productById = new Map(
        productRecords.map((product) => [product.id, product]),
      );
      cartRecords.forEach((cartItem) => {
        const sku = skuById.get(cartItem.skuId);
        const product = sku && productById.get(sku.productId);
        if (!sku?.isActive || !product?.isActive) {
          throw OrdersService.skuUnavailable(cartItem.skuId);
        }
      });

      const orderItems = cartRecords.map((cartItem) => {
        const sku = skuById.get(cartItem.skuId) as Sku;
        const product = productById.get(sku.productId) as Product;
        return orderItemRepo.create({
          productId: product.id,
          skuId: sku.id,
          productName: product.name,
          skuName: sku.name,
          skuAttributes: sku.attributes,
          imageUrl: sku.imageUrl ?? null,
          unitPriceCents: sku.priceCents,
          quantity: cartItem.quantity,
        });
      });
      const pricing = calculateMembershipPricing(
        orderItems.map(({ unitPriceCents, quantity }) => ({
          unitPriceCents,
          quantity,
        })),
        currentMembership?.discountBasisPoints ?? 10_000,
        quotePayload?.requestedCreditCents ?? 0,
        lockedAccount?.availableCreditCents ?? 0,
      );
      const pricedOrderItems = orderItems.map((item, index) =>
        orderItemRepo.create({ ...item, ...pricing.lines[index] }),
      );
      const stockReservations = cartRecords.reduce(
        (totals, cartItem) => ({
          ...totals,
          [cartItem.skuId]: (totals[cartItem.skuId] ?? 0) + cartItem.quantity,
        }),
        {} as Record<string, number>,
      );
      await Object.entries(stockReservations)
        .sort(([left], [right]) => left.localeCompare(right))
        .reduce(async (pending, [skuId, quantity]) => {
          await pending;
          const result = await manager
            .createQueryBuilder()
            .update(Sku)
            .set({
              stock: () => 'stock - :quantity',
              stockVersion: () => 'stock_version + 1',
            })
            .where('id = :skuId AND stock >= :quantity AND is_active = true', {
              skuId,
              quantity,
            })
            .execute();
          if (result.affected !== 1) {
            throw new ConflictException({
              code: ApiErrorCode.STOCK_INSUFFICIENT,
              message: 'Insufficient stock for one or more items.',
              details: { skuId },
            });
          }
        }, Promise.resolve());
      const orderNo = await this.generateOrderNo(orderRepo);
      const order = await orderRepo.save(
        orderRepo.create({
          orderNo,
          userId,
          status: OrderStatus.NEW,
          fulfillmentType: dto.fulfillmentType,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          pickupTimeText:
            dto.fulfillmentType === FulfillmentType.PICKUP
              ? (dto.pickupTimeText as string)
              : null,
          deliveryAddressText:
            dto.fulfillmentType === FulfillmentType.DELIVERY
              ? deliveryAddressSnapshot
              : null,
          goodsTotalCents: pricing.goodsTotalCents,
          membershipDiscountCents: pricing.membershipDiscountCents,
          creditAppliedCents: pricing.creditAppliedCents,
          payableTotalCents: pricing.payableTotalCents,
          membershipId: currentMembership?.id ?? null,
          membershipCode: currentMembership?.levelCode ?? null,
          membershipName: currentMembership?.levelName ?? null,
          membershipDiscountBasisPoints:
            currentMembership?.discountBasisPoints ?? null,
          pricingVersion: ORDER_PRICING_VERSION,
          remark: dto.remark ?? null,
        }),
      );

      if (lockedAccount && pricing.creditAppliedCents > 0) {
        await this.credit.debitFifo(manager, lockedAccount, {
          amountCents: pricing.creditAppliedCents,
          referenceType: 'PRODUCT_ORDER',
          referenceId: order.id,
          operationKey: `product-order-debit:${order.id}`,
        });
      }

      const persistedItems = await orderItemRepo.save(
        pricedOrderItems.map((item) =>
          orderItemRepo.create({ ...item, orderId: order.id }),
        ),
      );

      // Clear the source cart items only after the order is durably stored.
      await cartRepo.delete({ userId, id: In(dto.cartItemIds) });

      const responseSnapshot = this.toOrderView(order, persistedItems);
      await this.idempotencyService.complete(manager, {
        userId,
        operation: PRODUCT_ORDER_CREATE,
        key: idempotencyKey,
        requestHash,
        resourceType: ORDER_RESOURCE_TYPE,
        resourceId: order.id,
        responseSnapshot: responseSnapshot as OrderView &
          Record<string, unknown>,
        legacyOrderId: order.id,
      });

      return responseSnapshot;
    });
  }

  /**
   * Transition an order through the documented state machine. Refuses to
   * edit order content fields and refuses backwards/jumping/terminal
   * transitions. Cancellation writes an audit log row and returns a
   * `noRestock: true` hint so the admin UI can warn the operator that
   * stock is intentionally not replenished in this release.
   */
  async updateStatus(
    orderId: string,
    nextStatus: OrderStatus,
    adminUserId: string,
  ): Promise<OrderStatusUpdateResult> {
    const cancellationCandidate =
      nextStatus === OrderStatus.CANCELLED
        ? await this.orders.findOneBy({ id: orderId })
        : null;
    if (nextStatus === OrderStatus.CANCELLED && !cancellationCandidate) {
      throw new NotFoundException('Order not found');
    }

    return this.dataSource.transaction(async (manager) => {
      const lockedAccount =
        cancellationCandidate && cancellationCandidate.creditAppliedCents > 0
          ? await this.lockCancellationAccount(
              manager,
              cancellationCandidate.userId,
            )
          : null;
      const orderRepo = manager.getRepository(Order);
      const order = await orderRepo.findOne({
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (!canTransitionOrder(order.status, nextStatus)) {
        throw new UnprocessableEntityException({
          code: ApiErrorCode.INVALID_ORDER_TRANSITION,
          message: `Cannot transition order from ${order.status} to ${nextStatus}.`,
        });
      }

      const previousStatus = order.status;
      if (
        nextStatus === OrderStatus.CANCELLED &&
        order.creditAppliedCents > 0
      ) {
        if (!lockedAccount || lockedAccount.userId !== order.userId) {
          throw new ConflictException('订单取消账户状态已变更');
        }
        const originalEntry = await manager
          .getRepository(MemberCreditEntry)
          .findOne({
            where: { operationKey: `product-order-debit:${order.id}` },
          });
        if (!originalEntry) {
          throw OrdersService.memberCreditInconsistent();
        }
        OrdersService.assertOrderDebitMatches(
          originalEntry,
          lockedAccount,
          order,
        );
        await this.credit.reverseDebit(manager, lockedAccount, {
          originalEntryId: originalEntry.id,
          referenceType: 'PRODUCT_ORDER',
          referenceId: order.id,
          operationKey: `product-order-cancel:${order.id}`,
        });
      }

      const savedOrder = await orderRepo.save({ ...order, status: nextStatus });
      const noRestock = nextStatus === OrderStatus.CANCELLED;
      await this.audit.record(
        {
          adminUserId,
          targetEntity: 'orders',
          targetId: savedOrder.id,
          action: noRestock ? 'ORDER_CANCELLED' : 'ORDER_STATUS_CHANGED',
          changeSummary: {
            from: previousStatus,
            to: nextStatus,
            ...(noRestock ? { noRestock: true } : {}),
          },
        },
        manager,
      );

      const itemRepo = manager.getRepository(OrderItem);
      const items = await itemRepo.find({ where: { orderId: savedOrder.id } });
      return {
        order: this.toOrderView(savedOrder, items),
        noRestock,
      };
    });
  }

  /**
   * List the orders owned by a single customer. Newest first.
   */
  async listMine(userId: string): Promise<OrderView[]> {
    const orders = await this.orders.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(orders.map((order) => this.fetchOrderView(order)));
  }

  /** Admin-side lightweight list with contract-defined filtering and paging. */
  async listAll(query: AdminOrderListQuery): Promise<AdminOrderListResult> {
    const builder = applyOrderHeaderFilters(
      this.orders.createQueryBuilder('order'),
      query,
    );
    if (query.status) {
      builder.andWhere('order.status = :status', { status: query.status });
    }
    const [orders, total] = await builder
      .orderBy('order.createdAt', 'DESC')
      .addOrderBy('order.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    const aggregates = await this.aggregateOrderItems(
      orders.map(({ id }) => id),
    );
    return {
      items: orders.map((order) =>
        this.toAdminListItem(order, aggregates.get(order.id)),
      ),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getMine(userId: string, orderId: string): Promise<OrderView> {
    const order = await this.orders.findOne({ where: { id: orderId, userId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return this.fetchOrderView(order);
  }

  async getOne(orderId: string): Promise<OrderView> {
    const order = await this.orders.findOneBy({ id: orderId });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return this.fetchOrderView(order);
  }

  private async aggregateOrderItems(
    orderIds: readonly string[],
  ): Promise<ReadonlyMap<string, OrderItemAggregate>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.orderItems
      .createQueryBuilder('item')
      .select('item.orderId', 'orderId')
      .addSelect('COUNT(item.id)', 'itemLineCount')
      .addSelect('SUM(item.quantity)', 'totalQuantity')
      .where('item.orderId IN (:...orderIds)', { orderIds })
      .groupBy('item.orderId')
      .getRawMany<OrderItemAggregateRow>();
    return new Map(
      rows.map(({ orderId, itemLineCount, totalQuantity }) => [
        String(orderId),
        {
          itemLineCount: Number(itemLineCount),
          totalQuantity: Number(totalQuantity),
        },
      ]),
    );
  }

  private toAdminListItem(
    order: Order,
    aggregate: OrderItemAggregate | undefined,
  ): AdminOrderListItem {
    if (!aggregate) {
      throw new Error(`Order item aggregate missing for order ${order.id}`);
    }
    return {
      id: order.id,
      orderNo: order.orderNo,
      userId: order.userId,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      itemLineCount: aggregate.itemLineCount,
      totalQuantity: aggregate.totalQuantity,
      goodsTotalCents: order.goodsTotalCents,
      membershipDiscountCents: order.membershipDiscountCents,
      creditAppliedCents: order.creditAppliedCents,
      payableTotalCents: order.payableTotalCents,
      ...(order.pickupTimeText ? { pickupTimeText: order.pickupTimeText } : {}),
      ...(order.deliveryAddressText
        ? { deliveryAddressText: order.deliveryAddressText }
        : {}),
      ...(order.membershipCode ? { membershipCode: order.membershipCode } : {}),
      ...(order.membershipName ? { membershipName: order.membershipName } : {}),
      ...(order.membershipDiscountBasisPoints == null
        ? {}
        : {
            membershipDiscountBasisPoints: order.membershipDiscountBasisPoints,
          }),
      ...(order.remark ? { remark: order.remark } : {}),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private async fetchOrderView(order: Order): Promise<OrderView> {
    const items = await this.orderItems.find({ where: { orderId: order.id } });
    return this.toOrderView(order, items);
  }

  private toOrderView(order: Order, items: OrderItem[]): OrderView {
    const itemViews = items
      .slice()
      .sort((a, b) => (a.id > b.id ? 1 : -1))
      .map((item) => ({
        id: item.id,
        productName: item.productName,
        skuName: item.skuName,
        skuAttributes: item.skuAttributes,
        imageUrl: item.imageUrl ?? undefined,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        lineGoodsTotalCents: item.lineGoodsTotalCents,
        lineMembershipDiscountCents: item.lineMembershipDiscountCents,
        linePayableCents: item.linePayableCents,
      }));
    const common = {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      pickupTimeText: order.pickupTimeText ?? undefined,
      deliveryAddressText: order.deliveryAddressText ?? undefined,
      goodsTotalCents: order.goodsTotalCents,
      membershipDiscountCents: order.membershipDiscountCents,
      creditAppliedCents: order.creditAppliedCents,
      payableTotalCents: order.payableTotalCents,
      pricingVersion: order.pricingVersion,
      remark: order.remark ?? undefined,
      items: itemViews,
      createdAt: (order.createdAt ?? new Date()).toISOString(),
      updatedAt: (order.updatedAt ?? new Date()).toISOString(),
    };
    if (
      order.membershipId &&
      order.membershipCode &&
      order.membershipName &&
      order.membershipDiscountBasisPoints !== null
    ) {
      return {
        ...common,
        membershipId: order.membershipId,
        membershipCode: order.membershipCode,
        membershipName: order.membershipName,
        membershipDiscountBasisPoints: order.membershipDiscountBasisPoints,
      };
    }
    return common;
  }

  private validateQuoteIntent(
    userId: string,
    dto: CreateOrderDto,
  ): OrderQuoteTokenPayload | null {
    const hasRequestedCredit = dto.requestedCreditCents !== undefined;
    const hasQuoteToken = dto.quoteToken !== undefined;
    if (!hasRequestedCredit && !hasQuoteToken) return null;
    if (
      !Number.isInteger(dto.requestedCreditCents) ||
      (dto.requestedCreditCents as number) < 0 ||
      typeof dto.quoteToken !== 'string' ||
      dto.quoteToken.length === 0
    ) {
      throw OrdersService.orderQuoteStale();
    }

    const payload = this.quoteTokens.verify(dto.quoteToken, userId);
    const quotedCartItemIds = payload.cart
      .map(({ cartItemId }) => cartItemId)
      .toSorted();
    const requestedCartItemIds = [...dto.cartItemIds].sort();
    if (
      new Set(quotedCartItemIds).size !== quotedCartItemIds.length ||
      payload.requestedCreditCents !== dto.requestedCreditCents ||
      quotedCartItemIds.length !== requestedCartItemIds.length ||
      quotedCartItemIds.some(
        (cartItemId, index) => cartItemId !== requestedCartItemIds[index],
      )
    ) {
      throw OrdersService.orderQuoteStale();
    }
    return payload;
  }

  private assertQuoteVersions(
    payload: OrderQuoteTokenPayload | null,
    cartItems: CartItem[],
    skuById: Map<string, Sku>,
    membership: UserMembership | null,
    account: MemberAccount | null,
  ): void {
    if (!payload) return;
    const tokenCartById = new Map(
      payload.cart.map((item) => [item.cartItemId, item]),
    );
    const cartMatches = cartItems.every((cartItem) => {
      const quoted = tokenCartById.get(cartItem.id);
      const sku = skuById.get(cartItem.skuId);
      return Boolean(
        quoted &&
        sku &&
        quoted.skuId === cartItem.skuId &&
        quoted.quantity === cartItem.quantity &&
        quoted.stockVersion === sku.stockVersion,
      );
    });
    if (
      payload.pricingVersion !== ORDER_PRICING_VERSION ||
      payload.cart.length !== cartItems.length ||
      !cartMatches ||
      payload.membershipId !== (membership?.id ?? null) ||
      payload.membershipVersion !==
        (membership?.updatedAt.toISOString() ?? null) ||
      payload.accountVersion !== (account?.version ?? null)
    ) {
      throw OrdersService.orderQuoteStale();
    }
  }

  private async lockCancellationAccount(
    manager: Parameters<MembershipCreditService['lockOrCreateAccount']>[0],
    userId: string,
  ): Promise<MemberAccount> {
    const user = await manager.getRepository(User).findOne({
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.credit.lockOrCreateAccount(manager, userId);
  }

  private static isCurrentMembership(
    membership: UserMembership | null,
    now: Date,
  ): membership is UserMembership {
    return Boolean(
      membership &&
      membership.status === MembershipStatus.ACTIVE &&
      membership.startsAt <= now &&
      membership.endsAt > now,
    );
  }

  private static assertOrderDebitMatches(
    entry: MemberCreditEntry,
    account: MemberAccount,
    order: Order,
  ): void {
    if (
      entry.accountId !== account.id ||
      entry.direction !== MemberCreditDirection.DEBIT ||
      entry.type !== MemberCreditEntryType.PRODUCT_ORDER_DEBIT ||
      entry.referenceType !== 'PRODUCT_ORDER' ||
      entry.referenceId !== order.id ||
      entry.amountCents !== order.creditAppliedCents
    ) {
      throw OrdersService.memberCreditInconsistent();
    }
  }

  private static memberCreditInconsistent(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.MEMBER_CREDIT_INCONSISTENT,
      message: '订单消费金扣款记录不一致',
    });
  }

  private static skuUnavailable(skuId: string): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.SKU_UNAVAILABLE,
      message: 'SKU is not available for purchase.',
      details: { skuId },
    });
  }

  private static semanticCreateRequest(dto: CreateOrderDto) {
    return {
      cartItemIds: [...dto.cartItemIds].sort(),
      fulfillmentType: dto.fulfillmentType,
      contactName: dto.contactName,
      contactPhone: dto.contactPhone,
      pickupTimeText: dto.pickupTimeText ?? null,
      addressId: dto.addressId ?? null,
      requestedCreditCents: dto.requestedCreditCents ?? null,
      quoteToken: dto.quoteToken ?? null,
      remark: dto.remark ?? null,
    };
  }

  private static isOrderViewSnapshot(
    snapshot: unknown,
    resourceId: string,
  ): snapshot is OrderView {
    if (!OrdersService.isRecord(snapshot)) return false;
    const fulfillmentType = snapshot.fulfillmentType;
    const hasValidFulfillment =
      fulfillmentType === FulfillmentType.PICKUP
        ? typeof snapshot.pickupTimeText === 'string'
        : fulfillmentType === FulfillmentType.DELIVERY &&
          typeof snapshot.deliveryAddressText === 'string';
    const moneyFields = [
      snapshot.goodsTotalCents,
      snapshot.membershipDiscountCents,
      snapshot.creditAppliedCents,
      snapshot.payableTotalCents,
    ];
    const membershipFields = [
      snapshot.membershipId,
      snapshot.membershipCode,
      snapshot.membershipName,
      snapshot.membershipDiscountBasisPoints,
    ];
    const hasMembership = membershipFields.some((value) => value !== undefined);
    const hasCompleteMembership =
      typeof snapshot.membershipId === 'string' &&
      typeof snapshot.membershipCode === 'string' &&
      typeof snapshot.membershipName === 'string' &&
      OrdersService.isUnsignedInteger(snapshot.membershipDiscountBasisPoints);
    const valid = Boolean(
      snapshot.id === resourceId &&
      typeof snapshot.orderNo === 'string' &&
      snapshot.orderNo.length > 0 &&
      typeof snapshot.status === 'string' &&
      Object.values(OrderStatus).includes(snapshot.status as OrderStatus) &&
      hasValidFulfillment &&
      typeof snapshot.contactName === 'string' &&
      typeof snapshot.contactPhone === 'string' &&
      moneyFields.every(OrdersService.isUnsignedInteger) &&
      snapshot.payableTotalCents ===
        (snapshot.goodsTotalCents as number) -
          (snapshot.membershipDiscountCents as number) -
          (snapshot.creditAppliedCents as number) &&
      OrdersService.isUnsignedInteger(snapshot.pricingVersion) &&
      typeof snapshot.createdAt === 'string' &&
      typeof snapshot.updatedAt === 'string' &&
      Array.isArray(snapshot.items) &&
      snapshot.items.every(OrdersService.isOrderItemViewSnapshot) &&
      (!hasMembership || hasCompleteMembership),
    );
    if (!valid) return false;
    const items = snapshot.items as Array<Record<string, unknown>>;
    const itemTotals = items.reduce<{ goods: number; discount: number }>(
      (totals, item) => ({
        goods: totals.goods + (item.lineGoodsTotalCents as number),
        discount:
          totals.discount + (item.lineMembershipDiscountCents as number),
      }),
      { goods: 0, discount: 0 },
    );
    return (
      itemTotals.goods === snapshot.goodsTotalCents &&
      itemTotals.discount === snapshot.membershipDiscountCents
    );
  }

  private static isOrderItemViewSnapshot(item: unknown): boolean {
    if (!OrdersService.isRecord(item)) return false;
    const lineMoneyFields = [
      item.unitPriceCents,
      item.lineGoodsTotalCents,
      item.lineMembershipDiscountCents,
      item.linePayableCents,
    ];
    return Boolean(
      typeof item.id === 'string' &&
      item.id.length > 0 &&
      typeof item.productName === 'string' &&
      typeof item.skuName === 'string' &&
      OrdersService.isRecord(item.skuAttributes) &&
      Number.isSafeInteger(item.quantity) &&
      (item.quantity as number) > 0 &&
      lineMoneyFields.every(OrdersService.isUnsignedInteger) &&
      item.lineGoodsTotalCents ===
        (item.unitPriceCents as number) * (item.quantity as number) &&
      item.linePayableCents ===
        (item.lineGoodsTotalCents as number) -
          (item.lineMembershipDiscountCents as number),
    );
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private static isUnsignedInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
  }

  private static orderQuoteStale(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.ORDER_QUOTE_STALE,
      message: '订单报价已失效，请重新获取报价',
    });
  }

  private static formatAddress(address: Address): string {
    return [
      address.recipient,
      address.phone,
      [address.province, address.city, address.district]
        .filter(Boolean)
        .join(' '),
      address.detail,
    ]
      .filter(Boolean)
      .join(' / ');
  }

  /**
   * Generate an `BMYYYYMMDDNNNNNNNN` order number that does not collide with
   * any existing value. The 8-digit suffix uses a cryptographically random
   * integer; we retry on the (extremely unlikely) unique-key violation.
   */
  private async generateOrderNo(repo: Repository<Order>): Promise<string> {
    const today = new Date();
    const stamp =
      today.getUTCFullYear().toString() +
      String(today.getUTCMonth() + 1).padStart(2, '0') +
      String(today.getUTCDate()).padStart(2, '0');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = String(randomInt(0, 100_000_000)).padStart(8, '0');
      const candidate = `BM${stamp}${suffix}`;
      const existing = await repo.findOne({ where: { orderNo: candidate } });
      if (!existing) {
        return candidate;
      }
    }
    throw new ConflictException(
      'Failed to allocate a unique order number, please retry.',
    );
  }
}
