import 'reflect-metadata';

import {
  ApiErrorCode,
  FulfillmentType,
  MembershipTheme,
  OrderStatus,
} from '@bake-mall/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import * as entities from '../src/database/entities/index.js';
import { Address } from '../src/database/entities/address.entity.js';
import { CartItem } from '../src/database/entities/cart-item.entity.js';
import { IdempotencyRecord } from '../src/database/entities/idempotency-record.entity.js';
import { MembershipLevel } from '../src/database/entities/membership-level.entity.js';
import { MembershipPurchaseOrder } from '../src/database/entities/membership-purchase-order.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import { Sku } from '../src/database/entities/sku.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { IdempotencyService } from '../src/idempotency/idempotency.service.js';
import { MembershipCreditService } from '../src/membership/membership-credit.service.js';
import { MembershipEntitlementService } from '../src/membership/membership-entitlement.service.js';
import { MembershipPricingService } from '../src/membership/membership-pricing.service.js';
import { MembershipPurchaseService } from '../src/membership/membership-purchase.service.js';
import { OrderQuoteTokenService } from '../src/membership/order-quote-token.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_membership_order_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const DATABASE_OPTIONS = {
  databaseName: DATABASE_NAME,
  appUser: process.env.TEST_MYSQL_APP_USER ?? 'bake_app',
};
const APP_USER = DATABASE_OPTIONS.appUser;
const quoteTokens = new OrderQuoteTokenService('x'.repeat(32), 300);

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  return typeof response === 'object' && response !== null && 'code' in response
    ? (response as { code?: unknown }).code
    : undefined;
}

describe.sequential('membership purchase to order lifecycle (MySQL)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let database: DataSource | undefined;

  const requireDatabase = (): DataSource => {
    if (!database)
      throw new Error('Temporary MySQL data source is unavailable');
    return database;
  };

  beforeAll(async () => {
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      database = new DataSource({
        type: 'mysql',
        host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
        port: Number(process.env.TEST_MYSQL_PORT ?? 44306),
        database: DATABASE_NAME,
        username: APP_USER,
        password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
        charset: 'utf8mb4',
        timezone: 'Z',
        synchronize: false,
        entities: Object.values(entities),
        migrations: [...DATABASE_MIGRATIONS],
        migrationsTableName: 'migrations',
        migrationsTransactionMode: 'each',
      });
      await database.initialize();
      await database.runMigrations();
    } catch (error) {
      if (database?.isInitialized) await database.destroy();
      cleanupDatabase?.();
      cleanupDatabase = undefined;
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    try {
      if (database?.isInitialized) await database.destroy();
    } finally {
      cleanupDatabase?.();
      cleanupDatabase = undefined;
    }
    expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
      schemaCount: 0,
      grantCount: 0,
    });
  });

  it('carries a simulated purchase credit through quote, debit and cancellation without restocking or allowing void', async () => {
    const source = requireDatabase();
    const user = await source.getRepository(User).save(
      source.getRepository(User).create({
        phone: `139${String(process.pid).padStart(8, '0').slice(-8)}`,
        phoneVerified: true,
      }),
    );
    const admin = await source.getRepository(entities.AdminUser).save(
      source.getRepository(entities.AdminUser).create({
        username: `membership-order-admin-${process.pid}`,
        passwordHash: 'test-only',
        isActive: true,
      }),
    );
    const level = await source.getRepository(MembershipLevel).save(
      source.getRepository(MembershipLevel).create({
        code: `ORDER_FLOW_${process.pid}`,
        name: '订单链路会员',
        subtitle: null,
        description: null,
        rank: 110,
        priceCents: 9_900,
        grantCreditCents: 2_000,
        discountBasisPoints: 9_000,
        validDays: 365,
        benefits: [],
        theme: MembershipTheme.CHAMPAGNE,
        badgeText: 'FLOW',
        sortOrder: 10,
        isActive: true,
      }),
    );
    const categoryResult = await source.query(
      "INSERT INTO categories (name) VALUES ('会员订单验收分类')",
    );
    const product = await source.getRepository(Product).save(
      source.getRepository(Product).create({
        name: '会员订单验收蛋糕',
        categoryId: String(categoryResult.insertId),
        detailHtml: '<p>membership-order</p>',
        isActive: true,
      }),
    );
    const sku = await source.getRepository(Sku).save(
      source.getRepository(Sku).create({
        productId: product.id,
        name: '验收规格',
        attributes: {},
        priceCents: 10_000,
        stock: 2,
        isActive: true,
      }),
    );
    const cartItem = await source.getRepository(CartItem).save(
      source.getRepository(CartItem).create({
        userId: user.id,
        skuId: sku.id,
        quantity: 1,
      }),
    );

    const clock = () => new Date('2026-06-01T08:00:00.000Z');
    const credit = new MembershipCreditService();
    const entitlement = new MembershipEntitlementService();
    const audit = new AuditService(source.getRepository(entities.AuditLog));
    const purchaseService = new MembershipPurchaseService(
      source.getRepository(MembershipPurchaseOrder),
      source.getRepository(MembershipLevel),
      source.getRepository(entities.MemberAccount),
      source.getRepository(entities.UserMembership),
      source.getRepository(entities.MemberCreditGrant),
      source.getRepository(entities.MemberCreditEntry),
      source.getRepository(IdempotencyRecord),
      source.getRepository(entities.MembershipEntitlementSegment),
      source.getRepository(entities.Order),
      source,
      entitlement,
      credit,
      audit,
      {
        get: () => ({ NODE_ENV: 'test', SIMULATED_PAYMENT_ENABLED: true }),
      } as never,
      clock,
    );
    const pricing = new MembershipPricingService(
      source.getRepository(CartItem),
      source.getRepository(Sku),
      source.getRepository(Product),
      source.getRepository(entities.MemberAccount),
      source.getRepository(entities.UserMembership),
      quoteTokens,
      clock,
    );
    const orders = new OrdersService(
      source,
      source.getRepository(User),
      source.getRepository(entities.Order),
      source.getRepository(entities.OrderItem),
      source.getRepository(CartItem),
      source.getRepository(Sku),
      source.getRepository(Address),
      source.getRepository(Product),
      audit,
      quoteTokens,
      credit,
      new IdempotencyService(source.getRepository(IdempotencyRecord)),
    );

    const purchase = await purchaseService.createPurchase(
      user.id,
      randomUUID(),
      { levelId: level.id },
    );
    const paid = await purchaseService.simulatePayment(
      user.id,
      purchase.id,
      randomUUID(),
    );
    const quote = await pricing.quote(user.id, {
      cartItemIds: [cartItem.id],
      requestedCreditCents: 1_500,
    });

    expect(paid.membershipId).toEqual(expect.any(String));
    expect(quote).toMatchObject({
      goodsTotalCents: 10_000,
      membershipDiscountCents: 1_000,
      creditAppliedCents: 1_500,
      payableTotalCents: 7_500,
      availableCreditCents: 2_000,
      membership: expect.objectContaining({ id: paid.membershipId }),
    });

    const order = await orders.create(user.id, randomUUID(), {
      cartItemIds: [cartItem.id],
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: '会员用户',
      contactPhone: user.phone!,
      pickupTimeText: '明天 10:00',
      requestedCreditCents: 1_500,
      quoteToken: quote.quoteToken,
    });
    const [debitedAccount, debitEntries] = await Promise.all([
      source
        .getRepository(entities.MemberAccount)
        .findOneByOrFail({ userId: user.id }),
      source.getRepository(entities.MemberCreditEntry).find({
        where: { referenceType: 'PRODUCT_ORDER', referenceId: order.id },
      }),
    ]);

    expect(order).toMatchObject({
      membershipId: paid.membershipId,
      creditAppliedCents: 1_500,
      payableTotalCents: 7_500,
    });
    expect(debitedAccount.availableCreditCents).toBe(500);
    expect(debitEntries).toEqual([
      expect.objectContaining({
        type: 'PRODUCT_ORDER_DEBIT',
        amountCents: 1_500,
        operationKey: `product-order-debit:${order.id}`,
        reversalOfEntryId: null,
      }),
    ]);

    await orders.updateStatus(order.id, OrderStatus.PROCESSING, admin.id);
    const cancelled = await orders.updateStatus(
      order.id,
      OrderStatus.CANCELLED,
      admin.id,
    );
    const [account, persistedSku] = await Promise.all([
      source
        .getRepository(entities.MemberAccount)
        .findOneByOrFail({ userId: user.id }),
      source.getRepository(Sku).findOneByOrFail({ id: sku.id }),
    ]);

    expect(cancelled.noRestock).toBe(true);
    expect(account.availableCreditCents).toBe(2_000);
    expect(persistedSku.stock).toBe(1);
    await expect(
      purchaseService.voidPurchase(purchase.id, admin.id),
    ).rejects.toSatisfy(
      (error: unknown) =>
        errorCode(error) === ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
    );
  });
});
