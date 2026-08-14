import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrderItemSourceIds1718000000007 } from '../src/database/migrations/0008-order-item-source-ids.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_order_item_source_ids_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };

type OrderItemSnapshot = {
  id: string;
  product_name: string;
  sku_name: string;
  sku_attributes: string;
  unit_price_cents: number;
  quantity: number;
  line_goods_total_cents: number;
  line_membership_discount_cents: number;
  line_payable_cents: number;
  product_id: string | null;
  sku_id: string | null;
};

type ColumnMetadata = {
  column_name: string;
  column_type: string;
  is_nullable: 'YES' | 'NO';
};

function dataSource(): DataSource {
  return new DataSource({
    type: 'mysql',
    host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_MYSQL_PORT ?? 44306),
    database: DATABASE_NAME,
    username: APP_USER,
    password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
    charset: 'utf8mb4',
    timezone: 'Z',
    synchronize: false,
  });
}

async function createLegacyTables(source: DataSource): Promise<void> {
  await source.query(`CREATE TABLE \`products\` (
    \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`name\` VARCHAR(128) NOT NULL,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await source.query(`CREATE TABLE \`skus\` (
    \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`product_id\` BIGINT UNSIGNED NOT NULL,
    \`name\` VARCHAR(128) NOT NULL,
    \`attributes\` JSON NOT NULL,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await source.query(`CREATE TABLE \`order_items\` (
    \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`order_id\` BIGINT UNSIGNED NOT NULL,
    \`product_name\` VARCHAR(128) NOT NULL,
    \`sku_name\` VARCHAR(128) NOT NULL,
    \`sku_attributes\` JSON NOT NULL,
    \`unit_price_cents\` INT UNSIGNED NOT NULL,
    \`quantity\` INT UNSIGNED NOT NULL,
    \`line_goods_total_cents\` INT UNSIGNED NOT NULL,
    \`line_membership_discount_cents\` INT UNSIGNED NOT NULL,
    \`line_payable_cents\` INT UNSIGNED NOT NULL,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function createFixtures(source: DataSource): Promise<void> {
  await source.query(
    "INSERT INTO `products` (`id`, `name`) VALUES (1, '唯一蛋糕'), (2, '重复蛋糕'), (3, '重复蛋糕')",
  );
  await source.query(
    `INSERT INTO \`skus\` (\`id\`, \`product_id\`, \`name\`, \`attributes\`) VALUES
      (11, 1, '6寸', JSON_OBJECT('size', '6寸')),
      (21, 2, '6寸', JSON_OBJECT('size', '6寸')),
      (31, 3, '6寸', JSON_OBJECT('size', '6寸'))`,
  );
  await source.query(
    `INSERT INTO \`order_items\`
      (\`id\`, \`order_id\`, \`product_name\`, \`sku_name\`, \`sku_attributes\`,
       \`unit_price_cents\`, \`quantity\`, \`line_goods_total_cents\`,
       \`line_membership_discount_cents\`, \`line_payable_cents\`)
     VALUES
      (101, 1, '唯一蛋糕', '6寸', JSON_OBJECT('size', '6寸'), 6800, 2, 13600, 1360, 12240),
      (102, 1, '不存在蛋糕', '6寸', JSON_OBJECT('size', '6寸'), 8800, 1, 8800, 0, 8800),
      (103, 2, '重复蛋糕', '6寸', JSON_OBJECT('size', '6寸'), 9800, 3, 29400, 2940, 26460)`,
  );
}

async function readOrderItems(
  source: DataSource,
): Promise<OrderItemSnapshot[]> {
  return source.query(
    `SELECT \`id\`, \`product_name\`, \`sku_name\`, \`sku_attributes\`,
            \`unit_price_cents\`, \`quantity\`, \`line_goods_total_cents\`,
            \`line_membership_discount_cents\`, \`line_payable_cents\`,
            \`product_id\`, \`sku_id\`
     FROM \`order_items\` ORDER BY \`id\``,
  );
}

describe.sequential(
  '0008 order item source IDs migration on real MySQL',
  () => {
    const rootSql = createDockerRootSqlExecutor();
    let cleanupDatabase: (() => void) | undefined;
    let source: DataSource | undefined;
    let snapshotsBeforeMigration: Array<
      Omit<OrderItemSnapshot, 'product_id' | 'sku_id'>
    >;

    beforeAll(async () => {
      try {
        cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
        source = dataSource();
        await source.initialize();
        await createLegacyTables(source);
        await createFixtures(source);
        snapshotsBeforeMigration = await source.query(
          `SELECT \`id\`, \`product_name\`, \`sku_name\`, \`sku_attributes\`,
                \`unit_price_cents\`, \`quantity\`, \`line_goods_total_cents\`,
                \`line_membership_discount_cents\`, \`line_payable_cents\`
         FROM \`order_items\` ORDER BY \`id\``,
        );
        await new OrderItemSourceIds1718000000007().up(
          source.createQueryRunner(),
        );
      } catch (error) {
        if (source?.isInitialized) await source.destroy();
        source = undefined;
        cleanupDatabase?.();
        cleanupDatabase = undefined;
        throw error;
      }
    }, 60_000);

    afterAll(async () => {
      try {
        if (source?.isInitialized) await source.destroy();
      } finally {
        source = undefined;
        cleanupDatabase?.();
        cleanupDatabase = undefined;
      }
      expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
        schemaCount: 0,
        grantCount: 0,
      });
    });

    it('backfills only the unique exact candidate and preserves all immutable snapshots', async () => {
      const rows = await readOrderItems(source!);

      const snapshotKeys = Object.keys(
        snapshotsBeforeMigration[0] ?? {},
      ) as Array<keyof (typeof snapshotsBeforeMigration)[number]>;
      expect(
        rows.map((row) =>
          Object.fromEntries(snapshotKeys.map((key) => [key, row[key]])),
        ),
      ).toEqual(snapshotsBeforeMigration);
      expect(
        rows.map(({ id, product_id, sku_id }) => ({ id, product_id, sku_id })),
      ).toEqual([
        { id: '101', product_id: '1', sku_id: '11' },
        { id: '102', product_id: null, sku_id: null },
        { id: '103', product_id: null, sku_id: null },
      ]);
    });

    it('creates nullable unsigned source columns and both lookup indexes', async () => {
      const columns = (await source!.query(
        `SELECT COLUMN_NAME AS \`column_name\`,
              COLUMN_TYPE AS \`column_type\`,
              IS_NULLABLE AS \`is_nullable\`
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME='order_items'
         AND COLUMN_NAME IN ('product_id', 'sku_id')
       ORDER BY COLUMN_NAME`,
        [DATABASE_NAME],
      )) as ColumnMetadata[];
      const indexes = (await source!.query(
        `SELECT INDEX_NAME AS \`index_name\`
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME='order_items'
         AND INDEX_NAME IN ('idx_order_items_product', 'idx_order_items_sku')
       ORDER BY INDEX_NAME`,
        [DATABASE_NAME],
      )) as Array<{ index_name: string }>;

      expect(columns).toEqual([
        {
          column_name: 'product_id',
          column_type: 'bigint unsigned',
          is_nullable: 'YES',
        },
        {
          column_name: 'sku_id',
          column_type: 'bigint unsigned',
          is_nullable: 'YES',
        },
      ]);
      expect(indexes).toEqual([
        { index_name: 'idx_order_items_product' },
        { index_name: 'idx_order_items_sku' },
      ]);
    });

    it('removes both columns and indexes on down', async () => {
      await new OrderItemSourceIds1718000000007().down(
        source!.createQueryRunner(),
      );
      const columns = await source!.query(
        `SELECT \`column_name\`
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME='order_items'
         AND COLUMN_NAME IN ('product_id', 'sku_id')`,
        [DATABASE_NAME],
      );
      const indexes = await source!.query(
        `SELECT \`index_name\`
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME='order_items'
         AND INDEX_NAME IN ('idx_order_items_product', 'idx_order_items_sku')`,
        [DATABASE_NAME],
      );

      expect(columns).toEqual([]);
      expect(indexes).toEqual([]);
    });
  },
);
