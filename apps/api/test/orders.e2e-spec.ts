/* eslint-disable @typescript-eslint/no-explicit-any */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  ApiErrorCode,
  FulfillmentType,
  OrderStatus,
  type OrderView,
} from '@bake-mall/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuthModule } from '../src/auth/auth.module.js';
import {
  JWT_ADMIN_AUDIENCE,
  JWT_USER_AUDIENCE,
} from '../src/auth/auth.constants.js';
import { envSchema, type AppConfig } from '../src/config/env.schema.js';
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
import { MembershipEntitlementSegment } from '../src/database/entities/membership-entitlement-segment.entity.js';
import { MembershipLevel } from '../src/database/entities/membership-level.entity.js';
import { OrderQuoteTokenService } from '../src/membership/order-quote-token.service.js';
import { MembershipPurchaseOrder } from '../src/database/entities/membership-purchase-order.entity.js';
import { Order } from '../src/database/entities/order.entity.js';
import { OrderItem } from '../src/database/entities/order-item.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import { Sku } from '../src/database/entities/sku.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { UserMembership } from '../src/database/entities/user-membership.entity.js';
import { OrdersModule } from '../src/orders/orders.module.js';

/** Translate a TypeORM find operator (e.g. `In([...])`) into a matcher. */
function matchesOperator(recordValue: unknown, operator: unknown): boolean {
  if (
    operator &&
    typeof operator === 'object' &&
    '_type' in (operator as Record<string, unknown>) &&
    '_value' in (operator as Record<string, unknown>)
  ) {
    const list = ((operator as { _value: unknown[] })._value ??
      []) as unknown[];
    return list.includes(recordValue);
  }
  return recordValue === operator;
}

function matchesWhere(
  record: Record<string, unknown>,
  where?: Record<string, unknown>,
): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) =>
    matchesOperator(record[key], value),
  );
}

/**
 * Memory-backed repositories and data source sufficient to exercise the
 * transactional order flow without spinning up MySQL. The fake data source
 * forwards `transaction` callbacks to a manager whose `getRepository` looks
 * up the per-entity stub so each entity lives in its own records array while
 * still sharing one transaction scope.
 */
/** eslint-disable @typescript-eslint/no-explicit-any */
let fakeDataSourceRef: unknown;
function memoryRepository<T extends { id?: string } = object>(
  options: { assignTimestamps?: boolean } = {},
) {
  const { assignTimestamps = true } = options;
  const records: T[] = [];
  let nextId = 1;
  return {
    records,
    create: (value: Partial<T>) => value as T,
    save: async (value: T | T[]) => {
      const items = Array.isArray(value) ? value : [value];
      const saved: T[] = [];
      for (const item of items) {
        const copy: Record<string, unknown> = { ...item };
        if (!copy.id) copy.id = String(nextId++);
        if (assignTimestamps) {
          copy.createdAt ??= new Date();
          copy.updatedAt = new Date();
        }
        const index = records.findIndex((record) => record.id === copy.id);
        if (index >= 0) records[index] = copy as T;
        else records.push(copy as T);
        saved.push(copy as T);
      }
      return (Array.isArray(value) ? saved : saved[0]) as T & { id: string } & (
          T | T[]
        );
    },
    find: async ({
      where,
      order,
    }: {
      where?: Partial<T>;
      order?: Record<string, 'ASC' | 'DESC'>;
    } = {}) =>
      records
        .filter((record: T) =>
          matchesWhere(
            record as Record<string, unknown>,
            where as Record<string, unknown>,
          ),
        )
        .sort((a: T, b: T) => {
          if (!order) return 0;
          for (const [key, direction] of Object.entries(order)) {
            const aValue = (a as Record<string, unknown>)[key] as
              Date | number | string;
            const bValue = (b as Record<string, unknown>)[key] as
              Date | number | string;
            if (aValue === bValue) continue;
            return (aValue > bValue ? 1 : -1) * (direction === 'ASC' ? 1 : -1);
          }
          return 0;
        }),
    findOneBy: async (where: Partial<T>) =>
      records.find((record: T) =>
        Object.entries(where).every(
          ([key, value]) => (record as Record<string, unknown>)[key] === value,
        ),
      ) ?? null,
    findOneByOrFail: async (where: Partial<T>) => {
      const record = records.find((entry: T) =>
        Object.entries(where).every(
          ([key, value]) => (entry as Record<string, unknown>)[key] === value,
        ),
      );
      if (!record) throw new Error('Entity not found');
      return record;
    },
    findOne: async ({ where }: { where: Partial<T> }) =>
      records.find((record: T) =>
        matchesWhere(
          record as Record<string, unknown>,
          where as Record<string, unknown>,
        ),
      ) ?? null,
    update: async (where: Partial<T>, values: Partial<T>) => {
      const matching = records.filter((record: T) =>
        matchesWhere(
          record as Record<string, unknown>,
          where as Record<string, unknown>,
        ),
      );
      matching.forEach((record) => Object.assign(record, values));
      return { affected: matching.length };
    },
    delete: async (where: string | Partial<T>) => {
      const matching = records.filter((record: T) =>
        typeof where === 'string'
          ? (record as Record<string, unknown>).id === where
          : matchesWhere(
              record as Record<string, unknown>,
              where as Record<string, unknown>,
            ),
      );
      matching.forEach((record) => {
        const index = records.indexOf(record);
        if (index >= 0) records.splice(index, 1);
      });
      return { affected: matching.length };
    },
    insert: async (value: Partial<T>) => {
      const id = value.id ?? String(nextId++);
      records.push({ ...value, id } as T);
      return { identifiers: [{ id }], generatedMaps: [] };
    },
    count: async (where?: Partial<T>) => {
      if (!where) return records.length;
      return records.filter((record: T) =>
        Object.entries(where).every(
          ([key, value]) => record[key as keyof T] === value,
        ),
      ).length;
    },
  };
}

/**
 * Minimal Nest module that exposes the fake DataSource under the
 * `getDataSourceToken()` symbol so {@link OrdersService} can resolve it
 * during the e2e suite without standing up a real MySQL connection.
 */
@Global()
@Module({
  providers: [
    {
      provide: getDataSourceToken(),
      useFactory: () => fakeDataSourceRef,
    },
  ],
  exports: [getDataSourceToken()],
})
class FakeDatabaseModule {}

/** Build a fake TypeORM `DataSource` whose `transaction` hands a manager that
 * returns the same per-entity memory repositories used by the rest of the
 * spec. The transaction tracks SKU stock mutations and rolls them back when
 * the callback rejects, mirroring the semantics the real MySQL transaction
 * provides.
 */
function buildFakeDataSource(stubs: Record<string, any>) {
  return {
    transaction: async <T>(
      callback: (manager: unknown) => Promise<T>,
    ): Promise<T> => {
      // Snapshot the mutable state we may mutate inside the transaction so
      // we can restore it on rejection. The test asserts rollback semantics.
      const stockSnapshots = new Map<string, number>();
      const skuInsertSnapshots = new Map<string, number>();
      const cartInsertSnapshots = new Map<string, number>();
      stubs.skus.records.forEach((sku: any) => {
        if (sku.id !== undefined) stockSnapshots.set(sku.id, sku.stock);
      });
      stubs.idempotency.records.forEach(
        (record: IdempotencyRecord, index: number) => {
          if (record.id !== undefined) skuInsertSnapshots.set(record.id, index);
        },
      );
      stubs.cartItems.records.forEach((record: CartItem, index: number) => {
        if (record.id !== undefined) cartInsertSnapshots.set(record.id, index);
      });
      const orderInsertCount = stubs.orders.records.length;
      const orderItemInsertCount = stubs.orderItems.records.length;
      const idempotencyInsertCount = stubs.idempotency.records.length;
      const auditInsertCount = stubs.audit.records.length;
      const cartInsertCount = stubs.cartItems.records.length;
      const memberAccountInsertCount = stubs.memberAccounts.records.length;

      const manager = {
        query: async (_sql: string, parameters: unknown[]) => {
          const userId = String(parameters[0]);
          const existing = stubs.memberAccounts.records.some(
            (account: MemberAccount) => account.userId === userId,
          );
          if (!existing) {
            await stubs.memberAccounts.save({
              userId,
              activeMembershipId: null,
              availableCreditCents: 0,
              version: 1,
            });
          }
          return { affectedRows: 1 };
        },
        getRepository: (entity: { name: string }) => {
          const map: Record<string, ReturnType<typeof memoryRepository>> = {
            User: stubs.users,
            Order: stubs.orders,
            OrderItem: stubs.orderItems,
            CartItem: stubs.cartItems,
            Sku: stubs.skus,
            Address: stubs.addresses,
            IdempotencyRecord: stubs.idempotency,
            AuditLog: stubs.audit,
            Product: stubs.products,
            Category: stubs.categories,
            AdminUser: stubs.adminUsers,
            MemberAccount: stubs.memberAccounts,
            UserMembership: stubs.memberships,
          };
          const repo = map[entity.name];
          if (!repo) throw new Error(`Unknown entity ${entity.name}`);
          return repo;
        },
        createQueryBuilder: () => {
          let lastParams: Record<string, unknown> = {};
          const builder: {
            update: (entity: { name: string }) => typeof builder;
            set: (values: Record<string, unknown>) => typeof builder;
            where: (
              sql: string,
              params: Record<string, unknown>,
            ) => typeof builder;
            execute: () => Promise<{ affected: number }>;
          } = {
            update: () => builder,
            set: () => builder,
            where: (_sql: string, params: Record<string, unknown>) => {
              lastParams = params;
              return builder;
            },
            execute: async () => {
              // Apply the conditional decrement. We locate the SKU by id,
              // then atomically decrement stock if it satisfies
              // `stock >= quantity AND is_active = true`.
              const skuId = (lastParams['skuId' as string] ??
                lastParams['id' as string]) as string | undefined;
              const quantity = Number(lastParams['quantity']);
              const sku = stubs.skus.records.find((s: any) => s.id === skuId);
              if (!sku || !sku.isActive || sku.stock < quantity) {
                return { affected: 0 };
              }
              sku.stock = sku.stock - quantity;
              return { affected: 1 };
            },
          };
          return builder;
        },
      };
      try {
        return await callback(manager);
      } catch (err) {
        // Restore the mutable snapshots so a rejected transaction looks
        // identical to a rolled-back real database transaction.
        for (const sku of stubs.skus.records) {
          if (sku.id !== undefined) {
            const snap = stockSnapshots.get(sku.id);
            if (snap !== undefined) sku.stock = snap;
          }
        }
        stubs.orders.records.length = orderInsertCount;
        stubs.orderItems.records.length = orderItemInsertCount;
        stubs.idempotency.records.length = idempotencyInsertCount;
        stubs.audit.records.length = auditInsertCount;
        stubs.cartItems.records.length = cartInsertCount;
        stubs.memberAccounts.records.length = memberAccountInsertCount;
        void skuInsertSnapshots;
        void cartInsertSnapshots;
        throw err;
      }
    },
  };
}

describe('Orders domain (e2e)', () => {
  let app: INestApplication;
  let userHeaders: Record<string, string>;
  let adminHeaders: Record<string, string>;
  let fakeDataSource: ReturnType<typeof buildFakeDataSource>;
  let quoteTokens: OrderQuoteTokenService;
  let stubs: {
    users: any;
    orders: any;
    orderItems: any;
    cartItems: any;
    skus: any;
    addresses: any;
    idempotency: any;
    audit: any;
    products: any;
    categories: any;
    adminUsers: any;
    memberAccounts: any;
    memberships: any;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_USER_SECRET = 'orders-user-secret-for-e2e-tests';
    process.env.JWT_ADMIN_SECRET = 'orders-admin-secret-for-e2e-tests';
    process.env.MYSQL_HOST = '127.0.0.1';
    process.env.MYSQL_DATABASE = 'bake_mall_test';
    process.env.MYSQL_USER = 'bake_app_test';

    stubs = {
      users: memoryRepository<User>(),
      orders: memoryRepository<Order>(),
      orderItems: memoryRepository<OrderItem>({ assignTimestamps: false }),
      cartItems: memoryRepository<CartItem>(),
      skus: memoryRepository<Sku>(),
      addresses: memoryRepository<Address>(),
      idempotency: memoryRepository<IdempotencyRecord>({
        assignTimestamps: false,
      }),
      audit: memoryRepository<AuditLog>({ assignTimestamps: false }),
      products: memoryRepository<Product>(),
      categories: memoryRepository<Category>(),
      adminUsers: memoryRepository<AdminUser>(),
      memberAccounts: memoryRepository<MemberAccount>(),
      memberships: memoryRepository<UserMembership>(),
    };

    await stubs.users.save({
      id: 'user-1',
      phone: '13800000000',
      phoneVerified: true,
      nickname: 'Cake Fan',
      avatarUrl: null,
      wechatOpenid: null,
      wechatUnionid: null,
    } as User);
    await stubs.users.save({
      id: 'user-2',
      phone: '13900000000',
      phoneVerified: true,
      nickname: 'Pie Lover',
      avatarUrl: null,
      wechatOpenid: null,
      wechatUnionid: null,
    } as User);
    await stubs.categories.save({
      id: 'category-1',
      name: 'Cakes',
      isActive: true,
      sortOrder: 0,
    } as Category);
    await stubs.products.save({
      id: 'product-1',
      name: 'Birthday cake',
      categoryId: 'category-1',
      isActive: true,
      sortOrder: 0,
      detailHtml: '<p>birthday</p>',
      summary: null,
      coverImageUrl: null,
    } as Product);
    await stubs.skus.save({
      id: 'sku-1',
      productId: 'product-1',
      name: '6 inch',
      attributes: { size: '6' },
      priceCents: 6800,
      stock: 2,
      stockVersion: 1,
      imageUrl: null,
      isActive: true,
    } as unknown as Sku);
    await stubs.skus.save({
      id: 'sku-2',
      productId: 'product-1',
      name: '8 inch',
      attributes: { size: '8' },
      priceCents: 8800,
      stock: 1,
      imageUrl: null,
      isActive: true,
    } as unknown as Sku);
    await stubs.addresses.save({
      id: 'address-1',
      userId: 'user-1',
      recipient: 'Alice',
      phone: '13800000000',
      province: 'Zhejiang',
      city: 'Hangzhou',
      district: 'Xihu',
      detail: 'No. 1 Cake St',
      isDefault: true,
    } as Address);
    await stubs.adminUsers.save({
      id: 'admin-1',
      username: 'admin@example.test',
      passwordHash: 'irrelevant',
      isActive: true,
    } as AdminUser);

    fakeDataSource = buildFakeDataSource(stubs);
    fakeDataSourceRef = fakeDataSource;
    quoteTokens = new OrderQuoteTokenService('x'.repeat(32), 300);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: (raw) => {
            const { value, error } = envSchema.validate(raw ?? process.env, {
              abortEarly: false,
              stripUnknown: true,
            });
            if (error) throw new Error(error.message);
            return { appEnv: value };
          },
        }),
        AuthModule,
        FakeDatabaseModule,
        OrdersModule,
      ],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(fakeDataSource)
      .overrideProvider(getRepositoryToken(User))
      .useValue(stubs.users)
      .overrideProvider(getRepositoryToken(AdminUser))
      .useValue(stubs.adminUsers)
      .overrideProvider(getRepositoryToken(Order))
      .useValue(stubs.orders)
      .overrideProvider(getRepositoryToken(OrderItem))
      .useValue(stubs.orderItems)
      .overrideProvider(getRepositoryToken(CartItem))
      .useValue(stubs.cartItems)
      .overrideProvider(getRepositoryToken(Sku))
      .useValue(stubs.skus)
      .overrideProvider(getRepositoryToken(Address))
      .useValue(stubs.addresses)
      .overrideProvider(getRepositoryToken(IdempotencyRecord))
      .useValue(stubs.idempotency)
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue(stubs.audit)
      .overrideProvider(getRepositoryToken(Product))
      .useValue(stubs.products)
      .overrideProvider(getRepositoryToken(Category))
      .useValue(stubs.categories)
      .overrideProvider(getRepositoryToken(MemberAccount))
      .useValue({})
      .overrideProvider(getRepositoryToken(UserMembership))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditGrant))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditEntry))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditAllocation))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipLevel))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipPurchaseOrder))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipEntitlementSegment))
      .useValue({})
      .overrideProvider(OrderQuoteTokenService)
      .useValue(quoteTokens)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    const jwt = app.get(JwtService);
    const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
    userHeaders = {
      Authorization: `Bearer ${await jwt.signAsync(
        { sub: 'user-1', phone: '13800000000', aud: JWT_USER_AUDIENCE },
        { secret: config.get('appEnv', { infer: true }).JWT_USER_SECRET },
      )}`,
    };
    adminHeaders = {
      Authorization: `Bearer ${await jwt.signAsync(
        {
          sub: 'admin-1',
          email: 'admin@example.test',
          aud: JWT_ADMIN_AUDIENCE,
        },
        { secret: config.get('appEnv', { infer: true }).JWT_ADMIN_SECRET },
      )}`,
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  function stockOf(id: string): number {
    const sku = stubs.skus.records.find((s: any) => s.id === id);
    return sku?.stock ?? -1;
  }

  function seedCart(
    userId: string,
    items: Array<{ skuId: string; quantity: number }>,
  ): Promise<CartItem[]> {
    return Promise.all(
      items.map((item) =>
        stubs.cartItems.save({
          userId,
          skuId: item.skuId,
          quantity: item.quantity,
        } as CartItem),
      ),
    ) as Promise<CartItem[]>;
  }

  function setStock(skuId: string, stock: number): void {
    const sku = stubs.skus.records.find((s: any) => s.id === skuId);
    if (!sku) throw new Error(`Unknown sku ${skuId}`);
    sku.stock = stock;
  }

  function quoteIntent(cartItemIds: string[]) {
    const cart = cartItemIds.map((cartItemId) => {
      const cartItem = stubs.cartItems.records.find(
        (item: CartItem) => item.id === cartItemId,
      );
      const sku = stubs.skus.records.find(
        (item: Sku) => item.id === cartItem?.skuId,
      );
      if (!cartItem || !sku) throw new Error('Cart or SKU fixture is missing');
      return {
        cartItemId,
        skuId: cartItem.skuId,
        quantity: cartItem.quantity,
        stockVersion: sku.stockVersion,
      };
    });
    return {
      requestedCreditCents: 0,
      quoteToken: quoteTokens.issue({
        userId: 'user-1',
        cart,
        requestedCreditCents: 0,
        membershipId: null,
        membershipVersion: null,
        accountVersion: 1,
        pricingVersion: 1,
      }).token,
    };
  }

  function pickupRequest(
    cartItemIds: string[],
    overrides: Partial<{
      contactName: string;
      contactPhone: string;
      pickupTimeText: string;
      remark: string;
    }> = {},
  ) {
    return {
      cartItemIds,
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: overrides.contactName ?? 'Alice',
      contactPhone: overrides.contactPhone ?? '13800000000',
      pickupTimeText: overrides.pickupTimeText ?? 'tomorrow 10am',
      ...quoteIntent(cartItemIds),
      ...(overrides.remark ? { remark: overrides.remark } : {}),
    };
  }

  function deliveryRequest(
    cartItemIds: string[],
    overrides: Partial<{
      contactName: string;
      contactPhone: string;
      addressId: string;
      remark: string;
    }> = {},
  ) {
    return {
      cartItemIds,
      fulfillmentType: FulfillmentType.DELIVERY,
      contactName: overrides.contactName ?? 'Alice',
      contactPhone: overrides.contactPhone ?? '13800000000',
      addressId: overrides.addressId ?? 'address-1',
      ...quoteIntent(cartItemIds),
      ...(overrides.remark ? { remark: overrides.remark } : {}),
    };
  }

  it('rejects missing quote intent with 400 before opening a transaction', async () => {
    stubs.cartItems.records.length = 0;
    const cart = await seedCart('user-1', [{ skuId: 'sku-1', quantity: 1 }]);
    const transaction = vi.spyOn(fakeDataSource, 'transaction');

    const { requestedCreditCents, quoteToken, ...requestWithoutQuote } =
      pickupRequest(cart.map(({ id }) => id));

    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(userHeaders)
      .set('Idempotency-Key', 'missing-quote-intent')
      .send(requestWithoutQuote)
      .expect(400);
    void requestedCreditCents;
    void quoteToken;

    expect(transaction).not.toHaveBeenCalled();
    transaction.mockRestore();
    stubs.cartItems.records.length = 0;
  });

  it('rejects explicit null quote fields with 400 before opening a transaction', async () => {
    stubs.cartItems.records.length = 0;
    const cart = await seedCart('user-1', [{ skuId: 'sku-1', quantity: 1 }]);
    const transaction = vi.spyOn(fakeDataSource, 'transaction');

    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(userHeaders)
      .set('Idempotency-Key', 'null-quote-fields')
      .send({
        ...pickupRequest(cart.map(({ id }) => id)),
        requestedCreditCents: null,
        quoteToken: null,
      })
      .expect(400);

    expect(transaction).not.toHaveBeenCalled();
    transaction.mockRestore();
    stubs.cartItems.records.length = 0;
  });

  it('rolls back every SKU decrement when one cart item has insufficient stock', async () => {
    setStock('sku-1', 1);
    setStock('sku-2', 1);
    const cart = await seedCart('user-1', [
      { skuId: 'sku-1', quantity: 1 },
      { skuId: 'sku-2', quantity: 2 },
    ]);
    const cartIds = cart.map(
      (c: CartItem) => (c as CartItem & { id: string }).id,
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(userHeaders)
      .set('Idempotency-Key', 'rolls-back-stock-key')
      .send(pickupRequest(cartIds));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: ApiErrorCode.STOCK_INSUFFICIENT,
    });
    expect(stockOf('sku-1')).toBe(1);
    expect(stockOf('sku-2')).toBe(1);
    expect(stubs.orders.records).toHaveLength(0);
    expect(stubs.cartItems.records).toHaveLength(2);
  });

  it('returns the original order and decrements inventory only once for the same key', async () => {
    setStock('sku-1', 5);
    setStock('sku-2', 5);
    stubs.cartItems.records.length = 0;
    const cart = await seedCart('user-1', [{ skuId: 'sku-1', quantity: 2 }]);
    const cartIds = cart.map(
      (c: CartItem) => (c as CartItem & { id: string }).id,
    );

    const requestBody = pickupRequest(cartIds);
    const first = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(userHeaders)
      .set('Idempotency-Key', 'stable-key')
      .send(requestBody)
      .expect(201);
    const firstBody = first.body as OrderView;

    const second = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(userHeaders)
      .set('Idempotency-Key', 'stable-key')
      .send(requestBody)
      .expect(201);
    const secondBody = second.body as OrderView;

    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.orderNo).toBe(firstBody.orderNo);
    expect(stockOf('sku-1')).toBe(3);
  });

  it('rejects NEW→COMPLETED with 422 INVALID_ORDER_TRANSITION but accepts PROCESSING→COMPLETED', async () => {
    setStock('sku-1', 5);
    stubs.cartItems.records.length = 0;
    const cart = await seedCart('user-1', [{ skuId: 'sku-1', quantity: 1 }]);
    const cartIds = cart.map(
      (c: CartItem) => (c as CartItem & { id: string }).id,
    );

    const created = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(userHeaders)
      .set('Idempotency-Key', 'transition-test-key')
      .send(pickupRequest(cartIds))
      .expect(201);
    const order = created.body as OrderView;

    const illegal = await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(adminHeaders)
      .send({ status: OrderStatus.COMPLETED })
      .expect(422);
    expect(illegal.body).toMatchObject({
      code: ApiErrorCode.INVALID_ORDER_TRANSITION,
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(adminHeaders)
      .send({ status: OrderStatus.PROCESSING })
      .expect(200);

    const completed = await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(adminHeaders)
      .send({ status: OrderStatus.COMPLETED })
      .expect(200);
    expect(completed.body).toMatchObject({
      order: expect.objectContaining({
        id: order.id,
        status: OrderStatus.COMPLETED,
      }),
      noRestock: false,
    });
  });

  it.each([
    ['date-only createdAtFrom', 'createdAtFrom=2026-07-19'],
    ['offsetless createdAtBefore', 'createdAtBefore=2026-07-19T12%3A30%3A00'],
  ])('rejects %s in admin order filters', async (_name, query) => {
    await request(app.getHttpServer())
      .get(`/api/v1/admin/orders?${query}`)
      .set(adminHeaders)
      .expect(400);
  });

  it('does not expose any admin endpoint that edits order content fields', async () => {
    // The admin route table only includes the status endpoint. A PUT/PATCH
    // against the order itself must 404 because the route does not exist.
    setStock('sku-1', 5);
    stubs.cartItems.records.length = 0;
    const cart = await seedCart('user-1', [{ skuId: 'sku-1', quantity: 1 }]);
    const cartIds = cart.map(
      (c: CartItem) => (c as CartItem & { id: string }).id,
    );

    const created = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(userHeaders)
      .set('Idempotency-Key', 'no-edit-test-key')
      .send(pickupRequest(cartIds))
      .expect(201);
    const order = created.body as OrderView;

    await request(app.getHttpServer())
      .put(`/api/v1/admin/orders/${order.id}`)
      .set(adminHeaders)
      .send({ status: OrderStatus.CANCELLED, contactPhone: '000' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${order.id}`)
      .set(adminHeaders)
      .send({ status: OrderStatus.CANCELLED })
      .expect(404);
  });

  it('writes an audit log entry when an admin cancels an order and reports noRestock', async () => {
    setStock('sku-1', 5);
    stubs.cartItems.records.length = 0;
    const auditBefore = stubs.audit.records.length;
    const cart = await seedCart('user-1', [{ skuId: 'sku-1', quantity: 1 }]);
    const cartIds = cart.map(
      (c: CartItem) => (c as CartItem & { id: string }).id,
    );

    const created = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(userHeaders)
      .set('Idempotency-Key', 'cancel-audit-key')
      .send(pickupRequest(cartIds))
      .expect(201);
    const order = created.body as OrderView;

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(adminHeaders)
      .send({ status: OrderStatus.PROCESSING })
      .expect(200);

    const cancelled = await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(adminHeaders)
      .send({ status: OrderStatus.CANCELLED })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      order: expect.objectContaining({ status: OrderStatus.CANCELLED }),
      noRestock: true,
    });

    expect(stubs.audit.records.length).toBeGreaterThan(auditBefore + 1);
    const cancelLog = stubs.audit.records.find(
      (entry: any) =>
        entry.targetEntity === 'orders' &&
        entry.targetId === order.id &&
        entry.action === 'ORDER_CANCELLED',
    );
    expect(cancelLog).toBeDefined();
    expect(cancelLog?.changeSummary).toMatchObject({
      from: OrderStatus.PROCESSING,
      to: OrderStatus.CANCELLED,
      noRestock: true,
    });
    expect(stockOf('sku-1')).toBe(4);
  });

  it('persists immutable pickup and delivery snapshots', async () => {
    setStock('sku-1', 10);
    setStock('sku-2', 10);
    stubs.cartItems.records.length = 0;
    const cart = await seedCart('user-1', [
      { skuId: 'sku-1', quantity: 1 },
      { skuId: 'sku-2', quantity: 2 },
    ]);
    const cartIds = cart.map(
      (c: CartItem) => (c as CartItem & { id: string }).id,
    );

    const pickup = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(userHeaders)
      .set('Idempotency-Key', 'pickup-snapshot-key')
      .send(
        pickupRequest(cartIds, {
          contactName: 'Alice',
          contactPhone: '13800000000',
          pickupTimeText: '明天下午3点',
          remark: '请贴上生日牌',
        }),
      )
      .expect(201);
    const pickupOrder = pickup.body as OrderView;
    expect(pickupOrder.pickupTimeText).toBe('明天下午3点');
    expect(pickupOrder.deliveryAddressText).toBeUndefined();
    expect(pickupOrder.contactName).toBe('Alice');
    expect(pickupOrder.remark).toBe('请贴上生日牌');
    expect(pickupOrder.items).toHaveLength(2);
    const persistedPickupItems = stubs.orderItems.records.filter(
      (item: OrderItem) => item.orderId === pickupOrder.id,
    );
    expect(persistedPickupItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: 'product-1', skuId: 'sku-1' }),
        expect.objectContaining({ productId: 'product-1', skuId: 'sku-2' }),
      ]),
    );
    const totals = pickupOrder.items.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0,
    );
    expect(pickupOrder.goodsTotalCents).toBe(totals);

    // Mutate the live SKU price and address after the order is placed; the
    // snapshot must remain anchored to the values captured at creation time.
    const sku1 = stubs.skus.records.find((s: any) => s.id === 'sku-1');
    if (sku1) sku1.priceCents = 1;
    const addr = stubs.addresses.records.find((a: any) => a.id === 'address-1');
    if (addr) addr.detail = 'changed after order';

    const listed = await request(app.getHttpServer())
      .get('/api/v1/me/orders')
      .set(userHeaders)
      .expect(200);
    const refetched = listed.body.find(
      (o: OrderView) => o.id === pickupOrder.id,
    ) as OrderView;
    expect(
      refetched.items.find((item) => item.skuName === '6 inch')?.unitPriceCents,
    ).toBe(6800);

    // Re-seed the cart for the DELIVERY flow since the pickup order cleared
    // the source items.
    stubs.cartItems.records.length = 0;
    const deliveryCart = await seedCart('user-1', [
      { skuId: 'sku-1', quantity: 1 },
    ]);
    const deliveryCartIds = deliveryCart.map((c) => (c as { id: string }).id);

    const delivery = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(userHeaders)
      .set('Idempotency-Key', 'delivery-snapshot-key')
      .send(deliveryRequest(deliveryCartIds))
      .expect(201);
    const deliveryOrder = delivery.body as OrderView;
    // The address was mutated after the pickup order, so this DELIVERY order
    // captures the post-mutation value. The pickup snapshot above proves the
    // older order is not retroactively edited.
    expect(deliveryOrder.deliveryAddressText).toContain('changed after order');
    expect(deliveryOrder.pickupTimeText).toBeUndefined();
  });

  it('rejects an order without a verified phone', async () => {
    await stubs.users.save({
      id: 'user-3',
      phone: null,
      phoneVerified: false,
      nickname: 'No phone',
      avatarUrl: null,
      wechatOpenid: null,
      wechatUnionid: null,
    } as User);
    const jwt = app.get(JwtService);
    const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
    const headers = {
      Authorization: `Bearer ${await jwt.signAsync(
        { sub: 'user-3', phone: null, aud: JWT_USER_AUDIENCE },
        { secret: config.get('appEnv', { infer: true }).JWT_USER_SECRET },
      )}`,
    };
    await seedCart('user-3', [{ skuId: 'sku-1', quantity: 1 }]);
    const cartIds = stubs.cartItems.records
      .filter((c: any) => c.userId === 'user-3')
      .map((c: any) => c.id);
    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(headers)
      .set('Idempotency-Key', 'no-phone-key')
      .send(pickupRequest(cartIds));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: ApiErrorCode.PHONE_REQUIRED,
    });
  });
});
