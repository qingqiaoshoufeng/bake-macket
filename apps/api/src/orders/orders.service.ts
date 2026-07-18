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
import { IdempotencyRecord } from '../database/entities/idempotency-record.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { OrderItem } from '../database/entities/order-item.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { User } from '../database/entities/user.entity.js';
import { CreateOrderDto } from './dto/create-order.dto.js';

const UNIQUE_VIOLATION_CODE = 'ER_DUP_ENTRY';

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
    @InjectRepository(IdempotencyRecord)
    private readonly idempotency: Repository<IdempotencyRecord>,
    private readonly audit: AuditService,
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

    // Idempotency reservation happens before any other state lookup so that
    // a retry returns the original order without depending on the cart
    // still being populated (the cart is cleared once the order commits).
    const priorRecord = await this.idempotency.findOne({
      where: { userId, key: idempotencyKey },
    });
    if (priorRecord?.orderId) {
      const order = await this.orders.findOneByOrFail({
        id: priorRecord.orderId,
      });
      return this.fetchOrderView(order);
    }
    if (priorRecord) {
      throw new ConflictException({
        code: ApiErrorCode.STOCK_INSUFFICIENT,
        message:
          'Another request with the same Idempotency-Key is still being processed.',
      });
    }

    // Resolve cart items + SKUs + products in one go before the transaction so
    // a malformed payload never opens a database session.
    const cartRecords = await this.cartItems.find({
      where: { id: In(dto.cartItemIds), userId },
    });
    if (cartRecords.length !== dto.cartItemIds.length) {
      throw new NotFoundException('Cart item not found');
    }
    const skuIds = Array.from(new Set(cartRecords.map((c) => c.skuId)));
    const skuRecords = await this.skus.find({
      where: { id: In(skuIds) },
    });
    const skuById = new Map(skuRecords.map((s) => [s.id, s] as const));
    const productIds = Array.from(new Set(skuRecords.map((s) => s.productId)));
    const productRecords = await this.products.find({
      where: { id: In(productIds) },
    });
    const productById = new Map(productRecords.map((p) => [p.id, p] as const));

    // Validate SKU state (active flag and product existence) before touching
    // any stock counter.
    for (const cartItem of cartRecords) {
      const sku = skuById.get(cartItem.skuId);
      if (!sku || !sku.isActive) {
        throw new ConflictException({
          code: ApiErrorCode.SKU_UNAVAILABLE,
          message: 'SKU is not available for purchase.',
          details: { skuId: cartItem.skuId },
        });
      }
      const product = productById.get(sku.productId);
      if (!product || !product.isActive) {
        throw new ConflictException({
          code: ApiErrorCode.SKU_UNAVAILABLE,
          message: 'Product is not available for purchase.',
          details: { skuId: cartItem.skuId },
        });
      }
    }

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
      const idempotencyRepo = manager.getRepository(IdempotencyRecord);

      // Atomically reserve the idempotency key for the duration of the
      // transaction. The pre-transaction check above caught the "already
      // completed" and "in-flight" cases; here we either insert a fresh row
      // or detect that another concurrent caller raced us to it.
      try {
        await idempotencyRepo.insert({ userId, key: idempotencyKey });
      } catch (err) {
        if (OrdersService.isUniqueViolation(err)) {
          throw new ConflictException({
            code: ApiErrorCode.STOCK_INSUFFICIENT,
            message:
              'Another request with the same Idempotency-Key is still being processed.',
          });
        }
        throw err;
      }

      // Conditional decrement for every cart item. The cart order is the
      // shape sent to the customer, so we preserve it while applying the
      // atomic update. Any failure aborts the transaction (no order, no
      // idempotency stamp, no cart cleanup, no stock loss).
      const decremented: Array<{ skuId: string; quantity: number }> = [];
      for (const cartItem of cartRecords) {
        const sku = skuById.get(cartItem.skuId);
        if (!sku || !sku.isActive) {
          throw new ConflictException({
            code: ApiErrorCode.SKU_UNAVAILABLE,
            message: 'SKU is not available for purchase.',
            details: { skuId: cartItem.skuId },
          });
        }
        const result = await manager
          .createQueryBuilder()
          .update(Sku)
          .set({
            stock: () => 'stock - :quantity',
            stockVersion: () => 'stock_version + 1',
          })
          .where('id = :skuId AND stock >= :quantity AND is_active = true', {
            skuId: cartItem.skuId,
            quantity: cartItem.quantity,
          })
          .execute();
        if (result.affected !== 1) {
          throw new ConflictException({
            code: ApiErrorCode.STOCK_INSUFFICIENT,
            message: 'Insufficient stock for one or more items.',
            details: { skuId: cartItem.skuId },
          });
        }
        decremented.push({
          skuId: cartItem.skuId,
          quantity: cartItem.quantity,
        });
      }

      // Compute the order total from the snapshot prices, never from the
      // cart or any post-decrement counter.
      const orderItems: OrderItem[] = cartRecords.map((cartItem) => {
        const sku = skuById.get(cartItem.skuId) as Sku;
        const product = productById.get(sku.productId) as Product;
        return orderItemRepo.create({
          productName: product.name,
          skuName: sku.name,
          skuAttributes: sku.attributes,
          imageUrl: sku.imageUrl ?? null,
          unitPriceCents: sku.priceCents,
          quantity: cartItem.quantity,
        });
      });

      const orderNo = await this.generateOrderNo(orderRepo);
      const goodsTotalCents = orderItems.reduce(
        (sum, item) => sum + item.unitPriceCents * item.quantity,
        0,
      );
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
          goodsTotalCents,
          remark: dto.remark ?? null,
        }),
      );

      const persistedItems = await orderItemRepo.save(
        orderItems.map((item) =>
          orderItemRepo.create({ ...item, orderId: order.id }),
        ),
      );

      // Clear the source cart items only after the order is durably stored.
      await cartRepo.delete({ userId, id: In(dto.cartItemIds) });

      // Stamp the idempotency record so a retry returns the same order.
      await idempotencyRepo.update(
        { userId, key: idempotencyKey },
        { orderId: order.id },
      );

      void decremented; // mark intentional; not needed after the transaction
      return this.toOrderView(order, persistedItems);
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
    const order = await this.orders.findOneBy({ id: orderId });
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
    order.status = nextStatus;
    await this.orders.save(order);

    if (nextStatus === OrderStatus.CANCELLED) {
      await this.audit.record({
        adminUserId,
        targetEntity: 'orders',
        targetId: order.id,
        action: 'ORDER_CANCELLED',
        changeSummary: {
          from: previousStatus,
          to: OrderStatus.CANCELLED,
          noRestock: true,
        },
      });
      return {
        order: await this.fetchOrderView(order),
        noRestock: true,
      };
    }

    await this.audit.record({
      adminUserId,
      targetEntity: 'orders',
      targetId: order.id,
      action: 'ORDER_STATUS_CHANGED',
      changeSummary: {
        from: previousStatus,
        to: nextStatus,
      },
    });

    return {
      order: await this.fetchOrderView(order),
      noRestock: false,
    };
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
    const builder = this.orders.createQueryBuilder('order');
    if (query.orderNo?.trim()) {
      builder.andWhere('order.orderNo LIKE :orderNo', {
        orderNo: `%${query.orderNo.trim()}%`,
      });
    }
    if (query.status) {
      builder.andWhere('order.status = :status', { status: query.status });
    }
    if (query.fulfillmentType) {
      builder.andWhere('order.fulfillmentType = :fulfillmentType', {
        fulfillmentType: query.fulfillmentType,
      });
    }
    if (query.createdAtFrom) {
      builder.andWhere('order.createdAt >= :createdAtFrom', {
        createdAtFrom: new Date(query.createdAtFrom),
      });
    }
    if (query.createdAtBefore) {
      builder.andWhere('order.createdAt < :createdAtBefore', {
        createdAtBefore: new Date(query.createdAtBefore),
      });
    }
    const [orders, total] = await builder
      .orderBy('order.createdAt', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return {
      items: orders.map((order) => this.toAdminListItem(order)),
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

  private toAdminListItem(order: Order): AdminOrderListItem {
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      goodsTotalCents: order.goodsTotalCents,
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
      }));
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      pickupTimeText: order.pickupTimeText ?? undefined,
      deliveryAddressText: order.deliveryAddressText ?? undefined,
      goodsTotalCents: order.goodsTotalCents,
      remark: order.remark ?? undefined,
      items: itemViews,
      createdAt: (order.createdAt ?? new Date()).toISOString(),
      updatedAt: (order.updatedAt ?? new Date()).toISOString(),
    };
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

  private static isUniqueViolation(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const code = (err as { code?: string }).code;
    return code === UNIQUE_VIOLATION_CODE;
  }
}
