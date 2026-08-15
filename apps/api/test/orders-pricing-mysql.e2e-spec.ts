import 'reflect-metadata';

import {
  FulfillmentType,
  MemberCreditDirection,
  MemberCreditEntryType,
  MemberCreditGrantStatus,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipStatus,
  MembershipTheme,
  OrderStatus,
} from '@bake-mall/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Address } from '../src/database/entities/address.entity.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import { CartItem } from '../src/database/entities/cart-item.entity.js';
import { Category } from '../src/database/entities/category.entity.js';
import { IdempotencyRecord } from '../src/database/entities/idempotency-record.entity.js';
import { MemberAccount } from '../src/database/entities/member-account.entity.js';
import { MemberCreditAllocation } from '../src/database/entities/member-credit-allocation.entity.js';
import { MemberCreditEntry } from '../src/database/entities/member-credit-entry.entity.js';
import { MemberCreditGrant } from '../src/database/entities/member-credit-grant.entity.js';
import { Order } from '../src/database/entities/order.entity.js';
import { OrderItem } from '../src/database/entities/order-item.entity.js';
import { MembershipLevel } from '../src/database/entities/membership-level.entity.js';
import { MembershipPurchaseOrder } from '../src/database/entities/membership-purchase-order.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import { Sku } from '../src/database/entities/sku.entity.js';
import { UserMembership } from '../src/database/entities/user-membership.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { AuditService } from '../src/audit/audit.service.js';
import { IdempotencyService } from '../src/idempotency/idempotency.service.js';
import { MembershipCreditService } from '../src/membership/membership-credit.service.js';
import { OrderQuoteTokenService } from '../src/membership/order-quote-token.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_order_pricing_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };

describe.sequential('OrdersService MySQL pricing snapshots', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let dataSource: DataSource | undefined;

  beforeAll(async () => {
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      dataSource = new DataSource({
        type: 'mysql',
        host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
        port: Number(process.env.TEST_MYSQL_PORT ?? 44306),
        database: DATABASE_NAME,
        username: APP_USER,
        password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
        charset: 'utf8mb4',
        timezone: 'Z',
        synchronize: false,
        entities: [
          User,
          AdminUser,
          AuditLog,
          Address,
          Category,
          Product,
          Sku,
          CartItem,
          MembershipLevel,
          MembershipPurchaseOrder,
          UserMembership,
          MemberAccount,
          MemberCreditGrant,
          MemberCreditEntry,
          MemberCreditAllocation,
          Order,
          OrderItem,
          IdempotencyRecord,
        ],
        migrations: [...DATABASE_MIGRATIONS],
        migrationsTableName: 'migrations',
        migrationsTransactionMode: 'each',
      });
      await dataSource.initialize();
      await dataSource.runMigrations();
    } catch (error) {
      if (dataSource?.isInitialized) await dataSource.destroy();
      cleanupDatabase?.();
      cleanupDatabase = undefined;
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) await dataSource.destroy();
    } finally {
      cleanupDatabase?.();
      cleanupDatabase = undefined;
    }
    expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
      schemaCount: 0,
      grantCount: 0,
    });
  });

  it('persists a plain order that satisfies the pricing CHECK and line snapshots', async () => {
    if (!dataSource)
      throw new Error('Temporary MySQL data source was not initialized');

    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        phone: '13900000002',
        phoneVerified: true,
        orderContactPhone: '13900000009',
        orderContactPhoneVersion: 1,
      }),
    );
    const categoryResult = await dataSource.query(
      "INSERT INTO categories (name) VALUES ('回归分类')",
    );
    const categoryId = String(categoryResult.insertId);
    const product = await dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        name: '回归蛋糕',
        categoryId,
        detailHtml: '<p>test</p>',
        isActive: true,
      }),
    );
    const sku = await dataSource.getRepository(Sku).save(
      dataSource.getRepository(Sku).create({
        productId: product.id,
        name: '6寸',
        attributes: { size: '6寸' },
        priceCents: 6_800,
        stock: 5,
        isActive: true,
      }),
    );
    const cartItem = await dataSource.getRepository(CartItem).save(
      dataSource.getRepository(CartItem).create({
        userId: user.id,
        skuId: sku.id,
        quantity: 2,
      }),
    );

    const service = new OrdersService(
      dataSource,
      dataSource.getRepository(User),
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderItem),
      dataSource.getRepository(CartItem),
      dataSource.getRepository(Sku),
      dataSource.getRepository(Address),
      dataSource.getRepository(Product),
      { record: async () => undefined } as never,
      new OrderQuoteTokenService('x'.repeat(32), 300),
      new MembershipCreditService(),
      new IdempotencyService(dataSource.getRepository(IdempotencyRecord)),
    );

    const sharedIdempotencyKey = randomUUID();
    const membershipIdempotency = await dataSource
      .getRepository(IdempotencyRecord)
      .save(
        dataSource.getRepository(IdempotencyRecord).create({
          userId: user.id,
          operation: 'MEMBERSHIP_PURCHASE_CREATE',
          key: sharedIdempotencyKey,
          status: 'COMPLETED',
          orderId: null,
        }),
      );

    const view = await service.create(user.id, sharedIdempotencyKey, {
      cartItemIds: [cartItem.id],
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: '张三',
      orderContactPhoneVersion: user.orderContactPhoneVersion,
      pickupTimeText: '明天 10:00',
    });

    const order = await dataSource
      .getRepository(Order)
      .findOneByOrFail({ id: view.id });
    const items = await dataSource.getRepository(OrderItem).find({
      where: { orderId: view.id },
    });
    const idempotencyRecords = await dataSource
      .getRepository(IdempotencyRecord)
      .find({
        where: { userId: user.id, key: sharedIdempotencyKey },
      });
    expect(order).toMatchObject({
      status: OrderStatus.NEW,
      goodsTotalCents: 13_600,
      membershipDiscountCents: 0,
      creditAppliedCents: 0,
      payableTotalCents: 13_600,
      pricingVersion: 1,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      unitPriceCents: 6_800,
      quantity: 2,
      lineGoodsTotalCents: 13_600,
      lineMembershipDiscountCents: 0,
      linePayableCents: 13_600,
    });
    expect(idempotencyRecords).toHaveLength(2);
    expect(idempotencyRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: membershipIdempotency.id,
          operation: 'MEMBERSHIP_PURCHASE_CREATE',
          orderId: null,
        }),
        expect.objectContaining({
          operation: 'PRODUCT_ORDER_CREATE',
          orderId: view.id,
        }),
      ]),
    );
  });

  it('reprices with locked member state, debits FIFO, and reverses only credit on cancellation', async () => {
    if (!dataSource)
      throw new Error('Temporary MySQL data source was not initialized');

    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.save(
      userRepo.create({
        phone: '13900000003',
        phoneVerified: true,
        orderContactPhone: '13700000003',
        orderContactPhoneVersion: 1,
      }),
    );
    const admin = await dataSource.getRepository(AdminUser).save(
      dataSource.getRepository(AdminUser).create({
        username: `order-pricing-admin-${process.pid}`,
        passwordHash: 'test-only',
        isActive: true,
      }),
    );
    const categoryResult = await dataSource.query(
      "INSERT INTO categories (name) VALUES ('会员订单分类')",
    );
    const product = await dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        name: '会员蛋糕',
        categoryId: String(categoryResult.insertId),
        detailHtml: '<p>member</p>',
        isActive: true,
      }),
    );
    const sku = await dataSource.getRepository(Sku).save(
      dataSource.getRepository(Sku).create({
        productId: product.id,
        name: '8寸',
        attributes: { size: '8寸' },
        priceCents: 10_000,
        stock: 5,
        isActive: true,
      }),
    );
    const level = await dataSource.getRepository(MembershipLevel).save(
      dataSource.getRepository(MembershipLevel).create({
        code: `ORDER_PRICING_${process.pid}`,
        name: '鎏金会员',
        subtitle: null,
        description: null,
        rank: 110,
        priceCents: 9_900,
        grantCreditCents: 2_000,
        discountBasisPoints: 9_000,
        validDays: 365,
        benefits: [],
        theme: MembershipTheme.CHAMPAGNE,
        badgeText: 'GOLD',
        sortOrder: 10,
        isActive: true,
      }),
    );
    const purchaseRepo = dataSource.getRepository(MembershipPurchaseOrder);
    const purchase = await purchaseRepo.save(
      purchaseRepo.create({
        purchaseNo: `MP${String(process.pid).padStart(8, '0')}`,
        userId: user.id,
        membershipLevelId: level.id,
        levelCode: level.code,
        levelName: level.name,
        levelRank: level.rank,
        priceCents: level.priceCents,
        grantCreditCents: level.grantCreditCents,
        discountBasisPoints: level.discountBasisPoints,
        validDays: level.validDays,
        benefits: [],
        theme: level.theme,
        badgeText: level.badgeText,
        status: MembershipPurchaseStatus.FULFILLED,
        paymentStatus: MembershipPaymentStatus.SUCCEEDED,
        idempotencyKey: randomUUID(),
        requestHash: 'a'.repeat(64),
        paidAt: new Date(),
        voidedAt: null,
      }),
    );
    const membership = await dataSource.getRepository(UserMembership).save(
      dataSource.getRepository(UserMembership).create({
        userId: user.id,
        purchaseOrderId: purchase.id,
        membershipLevelId: level.id,
        levelCode: level.code,
        levelName: level.name,
        levelRank: level.rank,
        discountBasisPoints: level.discountBasisPoints,
        benefits: [],
        theme: level.theme,
        badgeText: level.badgeText,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2030-01-01T00:00:00.000Z'),
        previousMembershipId: null,
        status: MembershipStatus.ACTIVE,
      }),
    );
    const account = await dataSource.getRepository(MemberAccount).save(
      dataSource.getRepository(MemberAccount).create({
        userId: user.id,
        activeMembershipId: membership.id,
        availableCreditCents: 2_000,
      }),
    );
    const grantRepo = dataSource.getRepository(MemberCreditGrant);
    const grant = await grantRepo.save(
      grantRepo.create({
        accountId: account.id,
        purchaseOrderId: purchase.id,
        grantedCents: 2_000,
        remainingCents: 2_000,
        status: MemberCreditGrantStatus.ACTIVE,
      }),
    );
    await dataSource.getRepository(MemberCreditEntry).save(
      dataSource.getRepository(MemberCreditEntry).create({
        accountId: account.id,
        direction: MemberCreditDirection.CREDIT,
        type: MemberCreditEntryType.MEMBERSHIP_PURCHASE_GRANT,
        amountCents: 2_000,
        balanceAfterCents: 2_000,
        referenceType: 'MEMBERSHIP_PURCHASE',
        referenceId: purchase.id,
        operationKey: `membership-purchase-grant:${purchase.id}`,
        reversalOfEntryId: null,
      }),
    );
    const cartItem = await dataSource.getRepository(CartItem).save(
      dataSource.getRepository(CartItem).create({
        userId: user.id,
        skuId: sku.id,
        quantity: 1,
      }),
    );
    const quoteTokens = new OrderQuoteTokenService('x'.repeat(32), 300);
    const token = quoteTokens.issue({
      userId: user.id,
      cart: [
        {
          cartItemId: cartItem.id,
          skuId: sku.id,
          quantity: 1,
          stockVersion: sku.stockVersion,
        },
      ],
      requestedCreditCents: 1_500,
      membershipId: membership.id,
      membershipVersion: membership.updatedAt.toISOString(),
      accountVersion: account.version,
      pricingVersion: 1,
    }).token;
    const service = new OrdersService(
      dataSource,
      userRepo,
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderItem),
      dataSource.getRepository(CartItem),
      dataSource.getRepository(Sku),
      dataSource.getRepository(Address),
      dataSource.getRepository(Product),
      new AuditService(dataSource.getRepository(AuditLog)),
      quoteTokens,
      new MembershipCreditService(),
      new IdempotencyService(dataSource.getRepository(IdempotencyRecord)),
    );

    const created = await service.create(user.id, randomUUID(), {
      cartItemIds: [cartItem.id],
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: '李四',
      orderContactPhoneVersion: user.orderContactPhoneVersion,
      pickupTimeText: '明天 11:00',
      requestedCreditCents: 1_500,
      quoteToken: token,
    });
    await service.updateStatus(created.id, OrderStatus.PROCESSING, admin.id);
    const cancelled = await service.updateStatus(
      created.id,
      OrderStatus.CANCELLED,
      admin.id,
    );

    const savedOrder = await dataSource
      .getRepository(Order)
      .findOneByOrFail({ id: created.id });
    const savedAccount = await dataSource
      .getRepository(MemberAccount)
      .findOneByOrFail({ id: account.id });
    const savedGrant = await grantRepo.findOneByOrFail({ id: grant.id });
    const entries = await dataSource.getRepository(MemberCreditEntry).find({
      where: { referenceType: 'PRODUCT_ORDER', referenceId: created.id },
      order: { id: 'ASC' },
    });
    const savedSku = await dataSource
      .getRepository(Sku)
      .findOneByOrFail({ id: sku.id });

    expect(savedOrder).toMatchObject({
      status: OrderStatus.CANCELLED,
      goodsTotalCents: 10_000,
      membershipDiscountCents: 1_000,
      creditAppliedCents: 1_500,
      payableTotalCents: 7_500,
      membershipId: membership.id,
      membershipCode: level.code,
      membershipName: level.name,
      membershipDiscountBasisPoints: 9_000,
      pricingVersion: 1,
    });
    expect(savedAccount.availableCreditCents).toBe(2_000);
    expect(savedGrant).toMatchObject({
      grantedCents: 2_000,
      remainingCents: 2_000,
      status: MemberCreditGrantStatus.ACTIVE,
    });
    expect(
      entries.map(({ type, amountCents, reversalOfEntryId }) => ({
        type,
        amountCents,
        reversalOfEntryId,
      })),
    ).toEqual([
      {
        type: MemberCreditEntryType.PRODUCT_ORDER_DEBIT,
        amountCents: 1_500,
        reversalOfEntryId: null,
      },
      {
        type: MemberCreditEntryType.PRODUCT_ORDER_CANCEL_REVERSAL,
        amountCents: 1_500,
        reversalOfEntryId: entries[0]?.id,
      },
    ]);
    expect(savedSku.stock).toBe(4);
    expect(cancelled).toMatchObject({ noRestock: true });
  });
});
