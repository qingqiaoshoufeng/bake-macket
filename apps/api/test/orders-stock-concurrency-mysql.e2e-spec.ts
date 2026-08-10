import 'reflect-metadata';

import { ApiErrorCode, FulfillmentType } from '@bake-mall/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager, In } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import * as entities from '../src/database/entities/index.js';
import { CartItem } from '../src/database/entities/cart-item.entity.js';
import { Category } from '../src/database/entities/category.entity.js';
import { IdempotencyRecord } from '../src/database/entities/idempotency-record.entity.js';
import { MemberAccount } from '../src/database/entities/member-account.entity.js';
import { Order } from '../src/database/entities/order.entity.js';
import { OrderItem } from '../src/database/entities/order-item.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import { Sku } from '../src/database/entities/sku.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { IdempotencyService } from '../src/idempotency/idempotency.service.js';
import { MembershipCreditService } from '../src/membership/membership-credit.service.js';
import { OrderQuoteTokenService } from '../src/membership/order-quote-token.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_order_stock_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  return typeof response === 'object' && response !== null && 'code' in response
    ? (response as { code?: unknown }).code
    : undefined;
}

function errorStatus(error: unknown): unknown {
  return typeof error === 'object' &&
    error !== null &&
    'getStatus' in error &&
    typeof (error as { getStatus?: unknown }).getStatus === 'function'
    ? (error as { getStatus: () => number }).getStatus()
    : undefined;
}

function mysqlErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
}

function createBarrier(parties: number): { wait: () => Promise<void> } {
  let arrived = 0;
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    wait: async () => {
      arrived += 1;
      if (arrived >= parties) release();
      await released;
    },
  };
}

function dataSourceWithTransactionBarrier(source: DataSource): DataSource {
  const transactionBarrier = createBarrier(2);
  return new Proxy(source, {
    get(target, property, receiver) {
      if (property !== 'transaction') {
        return Reflect.get(target, property, receiver);
      }
      return <T>(operation: (manager: EntityManager) => Promise<T>) =>
        target.transaction(async (manager) => {
          await transactionBarrier.wait();
          return operation(manager);
        });
    },
  });
}

describe.sequential('order stock concurrency (MySQL)', () => {
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
      try {
        if (database?.isInitialized) await database.destroy();
      } finally {
        cleanupDatabase?.();
        cleanupDatabase = undefined;
      }
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

  it('allows exactly one of two users to buy the final unit', async () => {
    const source = requireDatabase();
    const userRepository = source.getRepository(User);
    const [firstUser, secondUser] = await userRepository.save(
      [
        { phone: '13800000001', phoneVerified: true },
        { phone: '13800000002', phoneVerified: true },
      ].map((fixture) => userRepository.create(fixture)),
    );
    const categoryRepository = source.getRepository(Category);
    const category = await categoryRepository.save(
      categoryRepository.create({ name: '最后一件并发分类' }),
    );
    const productRepository = source.getRepository(Product);
    const product = await productRepository.save(
      productRepository.create({
        name: '最后一件并发蛋糕',
        categoryId: category.id,
        detailHtml: '<p>concurrency</p>',
        isActive: true,
      }),
    );
    const skuRepository = source.getRepository(Sku);
    const sku = await skuRepository.save(
      skuRepository.create({
        productId: product.id,
        name: '唯一规格',
        attributes: { size: '唯一规格' },
        priceCents: 6_800,
        stock: 1,
        isActive: true,
      }),
    );
    const cartRepository = source.getRepository(CartItem);
    const [firstCartItem, secondCartItem] = await cartRepository.save(
      [firstUser, secondUser].map((user) =>
        cartRepository.create({ userId: user.id, skuId: sku.id, quantity: 1 }),
      ),
    );
    const service = new OrdersService(
      dataSourceWithTransactionBarrier(source),
      userRepository,
      source.getRepository(Order),
      source.getRepository(OrderItem),
      cartRepository,
      skuRepository,
      source.getRepository(entities.Address),
      productRepository,
      new AuditService(source.getRepository(entities.AuditLog)),
      new OrderQuoteTokenService('x'.repeat(32), 300),
      new MembershipCreditService(),
      new IdempotencyService(source.getRepository(IdempotencyRecord)),
    );
    const requests = [
      {
        user: firstUser,
        cartItem: firstCartItem,
        idempotencyKey: `stock-race-first-${randomUUID()}`,
      },
      {
        user: secondUser,
        cartItem: secondCartItem,
        idempotencyKey: `stock-race-second-${randomUUID()}`,
      },
    ];

    const outcomes = await Promise.allSettled(
      requests.map(({ user, cartItem, idempotencyKey }) =>
        service.create(user.id, idempotencyKey, {
          cartItemIds: [cartItem.id],
          fulfillmentType: FulfillmentType.PICKUP,
          contactName: `并发用户${user.id}`,
          contactPhone: user.phone as string,
          pickupTimeText: '明天 10:00',
        }),
      ),
    );

    const winnerIndex = outcomes.findIndex(
      (outcome) => outcome.status === 'fulfilled',
    );
    const loserIndex = outcomes.findIndex(
      (outcome) => outcome.status === 'rejected',
    );
    if (winnerIndex < 0 || loserIndex < 0 || winnerIndex === loserIndex) {
      throw new Error(
        `Expected one winner and one loser: ${JSON.stringify(outcomes)}`,
      );
    }
    const winner = outcomes[winnerIndex];
    const loser = outcomes[loserIndex];
    if (winner.status !== 'fulfilled' || loser.status !== 'rejected') {
      throw new Error('Concurrent order outcomes changed after indexing');
    }
    const winnerRequest = requests[winnerIndex];
    const loserRequest = requests[loserIndex];
    if (!winnerRequest || !loserRequest) {
      throw new Error('Concurrent order request index is unavailable');
    }

    const [
      savedSku,
      relatedOrders,
      relatedOrderItems,
      remainingCartItems,
      idempotencyRecords,
    ] = await Promise.all([
      skuRepository.findOneByOrFail({ id: sku.id }),
      source.getRepository(Order).find({
        where: { userId: In([firstUser.id, secondUser.id]) },
      }),
      source.getRepository(OrderItem).find({ where: { skuId: sku.id } }),
      cartRepository.find({
        where: { id: In([firstCartItem.id, secondCartItem.id]) },
      }),
      source.getRepository(IdempotencyRecord).find({
        where: {
          key: In(requests.map(({ idempotencyKey }) => idempotencyKey)),
        },
      }),
    ]);

    expect(outcomes).toHaveLength(2);
    expect(mysqlErrorCode(loser.reason)).not.toBeOneOf([
      'ER_LOCK_DEADLOCK',
      'ER_LOCK_WAIT_TIMEOUT',
      'ER_DUP_ENTRY',
    ]);
    expect(errorCode(loser.reason)).toBe(ApiErrorCode.STOCK_INSUFFICIENT);
    expect(errorStatus(loser.reason)).toBe(409);
    expect(savedSku.stock).toBe(0);
    expect(relatedOrders).toHaveLength(1);
    const savedOrder = relatedOrders[0];
    expect(savedOrder).toMatchObject({
      id: winner.value.id,
      userId: winnerRequest.user.id,
    });
    expect(relatedOrderItems).toEqual([
      expect.objectContaining({
        orderId: savedOrder?.id,
        skuId: sku.id,
        quantity: 1,
      }),
    ]);
    expect(remainingCartItems).toEqual([
      expect.objectContaining({
        id: loserRequest.cartItem.id,
        userId: loserRequest.user.id,
        skuId: sku.id,
        quantity: 1,
      }),
    ]);
    expect(
      remainingCartItems.some(({ id }) => id === winnerRequest.cartItem.id),
    ).toBe(false);
    expect(idempotencyRecords).toEqual([
      expect.objectContaining({
        userId: winnerRequest.user.id,
        operation: 'PRODUCT_ORDER_CREATE',
        key: winnerRequest.idempotencyKey,
        status: 'COMPLETED',
        resourceType: 'ORDER',
        resourceId: savedOrder?.id,
        orderId: savedOrder?.id,
      }),
    ]);
    expect(
      idempotencyRecords.some(({ key }) => key === loserRequest.idempotencyKey),
    ).toBe(false);
  });

  it('serializes different idempotency keys for the same user before reserving them', async () => {
    const source = requireDatabase();
    const userRepository = source.getRepository(User);
    const user = await userRepository.save(
      userRepository.create({ phone: '13800000005', phoneVerified: true }),
    );
    const categoryRepository = source.getRepository(Category);
    const category = await categoryRepository.save(
      categoryRepository.create({ name: '同用户幂等锁序分类' }),
    );
    const productRepository = source.getRepository(Product);
    const product = await productRepository.save(
      productRepository.create({
        name: '同用户幂等锁序蛋糕',
        categoryId: category.id,
        detailHtml: '<p>same-user-idempotency</p>',
        isActive: true,
      }),
    );
    const skuRepository = source.getRepository(Sku);
    const skus = await skuRepository.save(
      ['规格一', '规格二'].map((name) =>
        skuRepository.create({
          productId: product.id,
          name,
          attributes: { size: name },
          priceCents: 5_800,
          stock: 1,
          isActive: true,
        }),
      ),
    );
    const cartRepository = source.getRepository(CartItem);
    const cartItems = await cartRepository.save(
      skus.map((sku) =>
        cartRepository.create({ userId: user.id, skuId: sku.id, quantity: 1 }),
      ),
    );
    const service = new OrdersService(
      dataSourceWithTransactionBarrier(source),
      userRepository,
      source.getRepository(Order),
      source.getRepository(OrderItem),
      cartRepository,
      skuRepository,
      source.getRepository(entities.Address),
      productRepository,
      new AuditService(source.getRepository(entities.AuditLog)),
      new OrderQuoteTokenService('x'.repeat(32), 300),
      new MembershipCreditService(),
      new IdempotencyService(source.getRepository(IdempotencyRecord)),
    );
    const requests = cartItems.map((cartItem, index) => ({
      cartItem,
      idempotencyKey: `same-user-key-${index}-${randomUUID()}`,
    }));

    const outcomes = await Promise.allSettled(
      requests.map(({ cartItem, idempotencyKey }) =>
        service.create(user.id, idempotencyKey, {
          cartItemIds: [cartItem.id],
          fulfillmentType: FulfillmentType.PICKUP,
          contactName: '同用户并发',
          contactPhone: user.phone as string,
          pickupTimeText: '明天 11:00',
        }),
      ),
    );

    expect(outcomes).toEqual([
      expect.objectContaining({ status: 'fulfilled' }),
      expect.objectContaining({ status: 'fulfilled' }),
    ]);
    expect(
      outcomes
        .filter(
          (outcome): outcome is PromiseRejectedResult =>
            outcome.status === 'rejected',
        )
        .map(({ reason }) => mysqlErrorCode(reason)),
    ).not.toContain('ER_LOCK_DEADLOCK');
    const [orders, idempotencyRecords, remainingCartItems] = await Promise.all([
      source.getRepository(Order).findBy({ userId: user.id }),
      source.getRepository(IdempotencyRecord).find({
        where: {
          key: In(requests.map(({ idempotencyKey }) => idempotencyKey)),
        },
      }),
      cartRepository.findBy({ userId: user.id }),
    ]);
    expect(orders).toHaveLength(2);
    expect(idempotencyRecords).toHaveLength(2);
    expect(idempotencyRecords).toEqual([
      expect.objectContaining({ status: 'COMPLETED', userId: user.id }),
      expect.objectContaining({ status: 'COMPLETED', userId: user.id }),
    ]);
    expect(remainingCartItems).toEqual([]);
  });

  it('materializes accounts for two different new users concurrently', async () => {
    const source = requireDatabase();
    const userRepository = source.getRepository(User);
    const users = await userRepository.save(
      [
        { phone: '13800000003', phoneVerified: true },
        { phone: '13800000004', phoneVerified: true },
      ].map((fixture) => userRepository.create(fixture)),
    );
    const transactionBarrier = createBarrier(2);
    const credit = new MembershipCreditService();

    const outcomes = await Promise.allSettled(
      users.map((user) =>
        source.transaction(async (manager) => {
          await transactionBarrier.wait();
          return credit.lockOrCreateAccount(manager, user.id);
        }),
      ),
    );

    expect(outcomes).toEqual([
      expect.objectContaining({ status: 'fulfilled' }),
      expect.objectContaining({ status: 'fulfilled' }),
    ]);
    expect(
      outcomes
        .filter(
          (outcome): outcome is PromiseRejectedResult =>
            outcome.status === 'rejected',
        )
        .map(({ reason }) => mysqlErrorCode(reason)),
    ).not.toContain('ER_LOCK_DEADLOCK');
    const accounts = await source.getRepository(MemberAccount).find({
      where: { userId: In(users.map(({ id }) => id)) },
      order: { userId: 'ASC' },
    });
    expect(accounts).toHaveLength(2);
    expect(accounts.map(({ userId }) => userId).sort()).toEqual(
      users.map(({ id }) => id).sort(),
    );
    expect(accounts).toEqual([
      expect.objectContaining({
        activeMembershipId: null,
        availableCreditCents: 0,
        version: 1,
      }),
      expect.objectContaining({
        activeMembershipId: null,
        availableCreditCents: 0,
        version: 1,
      }),
    ]);
  });
});
