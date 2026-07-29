import 'reflect-metadata';

import {
  AdminOrderSupplyMatchType,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as entities from '../src/database/entities/index.js';
import { Category } from '../src/database/entities/category.entity.js';
import { Order } from '../src/database/entities/order.entity.js';
import { OrderItem } from '../src/database/entities/order-item.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import { Sku } from '../src/database/entities/sku.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { InitialSchema1718000000000 } from '../src/database/migrations/0001-initial-schema.js';
import { ProductSortOrder1718000000001 } from '../src/database/migrations/0002-product-sort-order.js';
import { Task12AdminMediaAndOrderIndexes1718000000002 } from '../src/database/migrations/0003-task12-admin-media-and-order-indexes.js';
import { SkuStockVersion1718000000003 } from '../src/database/migrations/0004-sku-stock-version.js';
import { MembershipAndOrderPricing1718000000004 } from '../src/database/migrations/0005-membership-and-order-pricing.js';
import { MembershipEntitlementSegments1718000000005 } from '../src/database/migrations/0006-membership-entitlement-segments.js';
import { DefaultMembershipLevels1718000000006 } from '../src/database/migrations/0007-default-membership-levels.js';
import { OrderItemSourceIds1718000000007 } from '../src/database/migrations/0008-order-item-source-ids.js';
import { AdminOrderQueryService } from '../src/orders/admin-order-query.service.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_order_supply_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const NEW_TIME = new Date('2026-07-20T01:00:00.000Z');
const PROCESSING_TIME = new Date('2026-07-20T02:00:00.000Z');
const LEGACY_EARLY_TIME = new Date('2026-07-20T00:00:00.000Z');

function orderFixture(
  userId: string,
  suffix: string,
  status: OrderStatus,
  createdAt: Date,
): Order {
  return {
    orderNo: `BM20260728${suffix.padStart(8, '0')}`,
    userId,
    status,
    fulfillmentType:
      status === OrderStatus.PROCESSING
        ? FulfillmentType.DELIVERY
        : FulfillmentType.PICKUP,
    contactName: status === OrderStatus.PROCESSING ? '李四' : '张三',
    contactPhone:
      status === OrderStatus.PROCESSING ? '13900000002' : '13900000001',
    pickupTimeText:
      status === OrderStatus.PROCESSING ? null : '2026-07-29 10:00',
    deliveryAddressText:
      status === OrderStatus.PROCESSING ? '上海市 / 浦东新区' : null,
    goodsTotalCents: 0,
    membershipDiscountCents: 0,
    creditAppliedCents: 0,
    payableTotalCents: 0,
    membershipId: null,
    membershipCode: null,
    membershipName: null,
    membershipDiscountBasisPoints: null,
    pricingVersion: 1,
    remark: status === OrderStatus.PROCESSING ? '配送备注' : null,
    createdAt,
    updatedAt: createdAt,
  } as Order;
}

function itemFixture(
  orderId: string,
  input: {
    productId: string | null;
    skuId: string | null;
    productName: string;
    skuName: string;
    skuAttributes: Record<string, string>;
    quantity: number;
  },
): OrderItem {
  return {
    orderId,
    ...input,
    imageUrl: null,
    unitPriceCents: 1_000,
    lineGoodsTotalCents: input.quantity * 1_000,
    lineMembershipDiscountCents: 0,
    linePayableCents: input.quantity * 1_000,
  } as OrderItem;
}

describe.sequential('AdminOrderQueryService real MySQL supply queries', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let dataSource: DataSource | undefined;
  let service: AdminOrderQueryService;
  let strawberrySku: Sku;
  let sameNameSku: Sku;
  let chocolateSku: Sku;

  beforeAll(async () => {
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      dataSource = new DataSource({
        type: 'mysql',
        host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
        port: Number(process.env.TEST_MYSQL_PORT ?? 3306),
        database: DATABASE_NAME,
        username: APP_USER,
        password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
        charset: 'utf8mb4',
        timezone: 'Z',
        synchronize: false,
        entities: Object.values(entities),
        migrations: [
          InitialSchema1718000000000,
          ProductSortOrder1718000000001,
          Task12AdminMediaAndOrderIndexes1718000000002,
          SkuStockVersion1718000000003,
          MembershipAndOrderPricing1718000000004,
          MembershipEntitlementSegments1718000000005,
          DefaultMembershipLevels1718000000006,
          OrderItemSourceIds1718000000007,
        ],
        migrationsTableName: 'migrations',
      });
      await dataSource.initialize();
      await dataSource.runMigrations();

      const user = await dataSource.getRepository(User).save(
        dataSource.getRepository(User).create({
          phone: '13900000001',
          phoneVerified: true,
        }),
      );
      const category = await dataSource.getRepository(Category).save(
        dataSource.getRepository(Category).create({
          name: '供货测试分类',
          isActive: true,
        }),
      );
      const strawberryProduct = await dataSource.getRepository(Product).save(
        dataSource.getRepository(Product).create({
          name: '草莓蛋糕',
          categoryId: category.id,
          detailHtml: '<p>草莓</p>',
          isActive: true,
        }),
      );
      const chocolateProduct = await dataSource.getRepository(Product).save(
        dataSource.getRepository(Product).create({
          name: '巧克力蛋糕',
          categoryId: category.id,
          detailHtml: '<p>巧克力</p>',
          isActive: true,
        }),
      );
      [strawberrySku, sameNameSku] = await dataSource.getRepository(Sku).save([
        dataSource.getRepository(Sku).create({
          productId: strawberryProduct.id,
          name: '6寸',
          attributes: { size: '6寸' },
          priceCents: 6_800,
          stock: 41,
          isActive: true,
        }),
        dataSource.getRepository(Sku).create({
          productId: strawberryProduct.id,
          name: '6寸',
          attributes: { size: '6寸' },
          priceCents: 6_800,
          stock: 17,
          isActive: true,
        }),
      ]);
      chocolateSku = await dataSource.getRepository(Sku).save(
        dataSource.getRepository(Sku).create({
          productId: chocolateProduct.id,
          name: '8寸',
          attributes: { size: '8寸' },
          priceCents: 8_800,
          stock: 29,
          isActive: true,
        }),
      );
      const orderRepository = dataSource.getRepository(Order);
      const [
        legacyEarlyOrder,
        newOrder,
        processingOrder,
        completedOrder,
        cancelledOrder,
      ] = await orderRepository.save([
        orderRepository.create(
          orderFixture(user.id, '1', OrderStatus.NEW, LEGACY_EARLY_TIME),
        ),
        orderRepository.create(
          orderFixture(user.id, '2', OrderStatus.NEW, NEW_TIME),
        ),
        orderRepository.create(
          orderFixture(user.id, '3', OrderStatus.PROCESSING, PROCESSING_TIME),
        ),
        orderRepository.create(
          orderFixture(
            user.id,
            '4',
            OrderStatus.COMPLETED,
            new Date('2026-07-20T03:00:00.000Z'),
          ),
        ),
        orderRepository.create(
          orderFixture(
            user.id,
            '5',
            OrderStatus.CANCELLED,
            new Date('2026-07-20T04:00:00.000Z'),
          ),
        ),
      ]);
      const itemRepository = dataSource.getRepository(OrderItem);
      await itemRepository.save(
        [
          itemFixture(legacyEarlyOrder.id, {
            productId: null,
            skuId: null,
            productName: '历史奶油蛋糕',
            skuName: '旧规格',
            skuAttributes: { flavor: '奶油' },
            quantity: 10,
          }),
          itemFixture(newOrder.id, {
            productId: strawberryProduct.id,
            skuId: strawberrySku.id,
            productName: strawberryProduct.name,
            skuName: strawberrySku.name,
            skuAttributes: strawberrySku.attributes,
            quantity: 5,
          }),
          itemFixture(newOrder.id, {
            productId: strawberryProduct.id,
            skuId: sameNameSku.id,
            productName: strawberryProduct.name,
            skuName: sameNameSku.name,
            skuAttributes: sameNameSku.attributes,
            quantity: 8,
          }),
          itemFixture(legacyEarlyOrder.id, {
            productId: chocolateProduct.id,
            skuId: chocolateSku.id,
            productName: 'Z代表商品',
            skuName: 'Z代表规格',
            skuAttributes: { rank: 'z-representative' },
            quantity: 4,
          }),
          itemFixture(newOrder.id, {
            productId: strawberryProduct.id,
            skuId: chocolateSku.id,
            productName: 'Z后续商品',
            skuName: 'Z后续规格',
            skuAttributes: { rank: 'z-later' },
            quantity: 2,
          }),
          itemFixture(newOrder.id, {
            productId: chocolateProduct.id,
            skuId: chocolateSku.id,
            productName: 'A后续商品',
            skuName: 'Z后续规格',
            skuAttributes: { rank: 'z-later' },
            quantity: 1,
          }),
          itemFixture(newOrder.id, {
            productId: chocolateProduct.id,
            skuId: chocolateSku.id,
            productName: 'Z后续商品',
            skuName: 'A后续规格',
            skuAttributes: { rank: 'z-later' },
            quantity: 1,
          }),
          itemFixture(newOrder.id, {
            productId: chocolateProduct.id,
            skuId: chocolateSku.id,
            productName: 'Z后续商品',
            skuName: 'Z后续规格',
            skuAttributes: { rank: 'a-later' },
            quantity: 2,
          }),
          itemFixture(processingOrder.id, {
            productId: strawberryProduct.id,
            skuId: strawberrySku.id,
            productName: strawberryProduct.name,
            skuName: strawberrySku.name,
            skuAttributes: strawberrySku.attributes,
            quantity: 3,
          }),
          itemFixture(processingOrder.id, {
            productId: null,
            skuId: null,
            productName: '历史奶油蛋糕',
            skuName: '旧规格',
            skuAttributes: { flavor: '奶油' },
            quantity: 2,
          }),
          itemFixture(completedOrder.id, {
            productId: strawberryProduct.id,
            skuId: strawberrySku.id,
            productName: strawberryProduct.name,
            skuName: strawberrySku.name,
            skuAttributes: strawberrySku.attributes,
            quantity: 100,
          }),
          itemFixture(cancelledOrder.id, {
            productId: strawberryProduct.id,
            skuId: strawberrySku.id,
            productName: strawberryProduct.name,
            skuName: strawberrySku.name,
            skuAttributes: strawberrySku.attributes,
            quantity: 100,
          }),
        ].map((item) => itemRepository.create(item)),
      );
      service = new AdminOrderQueryService(itemRepository);
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

  it('groups by SKU ID, keeps legacy rows, splits active statuses, and excludes terminal orders', async () => {
    const result = await service.listSupply({
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      page: 1,
      pageSize: 20,
    });
    const strawberry = result.items.find(
      ({ skuId }) => skuId === strawberrySku.id,
    );
    const sameName = result.items.find(({ skuId }) => skuId === sameNameSku.id);
    const chocolate = result.items.find(({ skuId }) => skuId === chocolateSku.id);
    const legacy = result.items.find(
      ({ matchType }) =>
        matchType === AdminOrderSupplyMatchType.LEGACY_FALLBACK,
    );

    expect(result.total).toBe(4);
    expect(
      result.items.map(({ requiredQuantity }) => requiredQuantity),
    ).toEqual([12, 10, 8, 8]);
    expect(result.items.map(({ groupKey }) => groupKey)).toEqual([
      legacy?.groupKey,
      `sku:${chocolateSku.id}`,
      `sku:${strawberrySku.id}`,
      `sku:${sameNameSku.id}`,
    ]);
    expect(chocolate).toMatchObject({
      groupKey: `sku:${chocolateSku.id}`,
      productId: chocolateSku.productId,
      productName: 'Z代表商品',
      skuName: 'Z代表规格',
      skuAttributes: { rank: 'z-representative' },
      requiredQuantity: 10,
      orderCount: 2,
      newQuantity: 10,
      processingQuantity: 0,
    });
    expect(strawberry).toMatchObject({
      groupKey: `sku:${strawberrySku.id}`,
      productName: '草莓蛋糕',
      skuName: '6寸',
      requiredQuantity: 8,
      orderCount: 2,
      newQuantity: 5,
      processingQuantity: 3,
      remainingSaleableStock: 41,
      matchType: AdminOrderSupplyMatchType.SKU_ID,
    });
    expect(sameName).toMatchObject({
      groupKey: `sku:${sameNameSku.id}`,
      productName: '草莓蛋糕',
      skuName: '6寸',
      requiredQuantity: 8,
      orderCount: 1,
    });
    expect(strawberry?.groupKey).not.toBe(sameName?.groupKey);
    expect(legacy).toMatchObject({
      groupKey: expect.stringMatching(/^legacy:[a-f0-9]{64}$/),
      requiredQuantity: 12,
      orderCount: 2,
      newQuantity: 10,
      processingQuantity: 2,
      earliestOrderCreatedAt: LEGACY_EARLY_TIME.toISOString(),
    });
    expect(legacy).not.toHaveProperty('remainingSaleableStock');
  });

  it('applies itemQ to only the current order item and keeps database pagination stable', async () => {
    const filtered = await service.listSupply({
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      itemQ: '草莓',
      page: 1,
      pageSize: 20,
    });
    const secondPage = await service.listSupply({
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      page: 2,
      pageSize: 2,
    });

    expect(filtered.total).toBe(2);
    expect(filtered.items.map(({ skuId }) => skuId)).toEqual([
      strawberrySku.id,
      sameNameSku.id,
    ]);
    expect(filtered.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productName: '巧克力蛋糕' }),
      ]),
    );
    expect(secondPage).toMatchObject({ page: 2, pageSize: 2, total: 4 });
    expect(secondPage.items.map(({ groupKey }) => groupKey)).toEqual([
      `sku:${strawberrySku.id}`,
      `sku:${sameNameSku.id}`,
    ]);
  });

  it('supports one active status and rejects completed or cancelled supply scopes', async () => {
    const processing = await service.listSupply({
      supplyStatuses: [OrderStatus.PROCESSING],
      page: 1,
      pageSize: 20,
    });

    expect(
      processing.items.map(({ requiredQuantity }) => requiredQuantity),
    ).toEqual([3, 2]);
    await expect(
      service.listSupply({
        supplyStatuses: [OrderStatus.COMPLETED] as never,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.listSupplyItems({
        groupKey: `sku:${strawberrySku.id}`,
        supplyStatuses: [OrderStatus.CANCELLED] as never,
        page: 1,
        pageSize: 50,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('expands an opaque legacy group into complete details in stable order', async () => {
    const summary = await service.listSupply({
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      page: 1,
      pageSize: 20,
    });
    const legacy = summary.items.find(
      ({ matchType }) =>
        matchType === AdminOrderSupplyMatchType.LEGACY_FALLBACK,
    );
    if (!legacy) throw new Error('Legacy fixture group is missing');

    const details = await service.listSupplyItems({
      groupKey: legacy.groupKey,
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      page: 1,
      pageSize: 50,
    });

    expect(details).toMatchObject({ page: 1, pageSize: 50, total: 2 });
    expect(details.items.map(({ quantity }) => quantity)).toEqual([10, 2]);
    expect(details.items[0]).toMatchObject({
      status: OrderStatus.NEW,
      fulfillmentType: FulfillmentType.PICKUP,
      pickupTimeText: '2026-07-29 10:00',
      productName: '历史奶油蛋糕',
      skuName: '旧规格',
      skuAttributes: { flavor: '奶油' },
      unitPriceCents: 1_000,
      lineGoodsTotalCents: 10_000,
      lineMembershipDiscountCents: 0,
      linePayableCents: 10_000,
      orderCreatedAt: LEGACY_EARLY_TIME.toISOString(),
    });
    expect(details.items[1]).toMatchObject({
      status: OrderStatus.PROCESSING,
      fulfillmentType: FulfillmentType.DELIVERY,
      deliveryAddressText: '上海市 / 浦东新区',
      remark: '配送备注',
      orderCreatedAt: PROCESSING_TIME.toISOString(),
    });
  });
});
