import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { DataSource, type MigrationInterface } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const FINAL_NAMES = [
  'HomepageMultipleDrafts1718000000009',
  'UserAdminIdentity1718000000009',
  'CloudPrinters1718000000010',
] as const;
const rootSql = createDockerRootSqlExecutor();

type MigrationClass = new () => MigrationInterface;

type History = {
  label: string;
  executedNames: readonly string[];
};

const histories: History[] = [
  {
    label: 'main homepage drafts history',
    executedNames: [
      'InitialSchema1718000000000',
      'ProductSortOrder1718000000001',
      'Task12AdminMediaAndOrderIndexes1718000000002',
      'SkuStockVersion1718000000003',
      'MembershipAndOrderPricing1718000000004',
      'MembershipEntitlementSegments1718000000005',
      'DefaultMembershipLevels1718000000006',
      'OrderItemSourceIds1718000000007',
      'HomepagePages1718000000008',
      'HomepageMultipleDrafts1718000000009',
    ],
  },
  {
    label: 'outcrop identity and cloud printing history',
    executedNames: [
      'InitialSchema1718000000000',
      'ProductSortOrder1718000000001',
      'Task12AdminMediaAndOrderIndexes1718000000002',
      'SkuStockVersion1718000000003',
      'MembershipAndOrderPricing1718000000004',
      'MembershipEntitlementSegments1718000000005',
      'DefaultMembershipLevels1718000000006',
      'OrderItemSourceIds1718000000007',
      'HomepagePages1718000000008',
      'UserAdminIdentity1718000000009',
      'CloudPrinters1718000000010',
    ],
  },
];

const migrationsNamed = (names: readonly string[]): MigrationClass[] =>
  names.map((name) => {
    const matches = DATABASE_MIGRATIONS.filter(
      (migration) => migration.name === name,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one registered migration named ${name}, received ${matches.length}`,
      );
    }
    return matches[0] as MigrationClass;
  });

const createDataSource = (
  database: string,
  migrations: readonly MigrationClass[],
): DataSource =>
  new DataSource({
    type: 'mysql',
    host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_MYSQL_PORT ?? 44306),
    database,
    username: APP_USER,
    password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
    charset: 'utf8mb4',
    timezone: 'Z',
    synchronize: false,
    entities: [],
    migrations: [...migrations],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
  });

describe.sequential(
  'final migration registry dual-history compatibility (MySQL)',
  () => {
    let databaseName = '';
    let cleanupDatabase: (() => void) | undefined;
    let source: DataSource | undefined;

    afterEach(async () => {
      try {
        if (source?.isInitialized) await source.destroy();
      } finally {
        cleanupDatabase?.();
        cleanupDatabase = undefined;
      }
      expect(
        mysqlTestDatabaseState(rootSql, {
          databaseName,
          appUser: APP_USER,
        }),
      ).toEqual({ schemaCount: 0, grantCount: 0 });
    }, 60_000);

    it.each(histories)(
      'upgrades $label without replaying an executed migration',
      async ({ executedNames }) => {
        databaseName = `bake_mall_dual_history_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
        cleanupDatabase = provisionMysqlTestDatabase(rootSql, {
          databaseName,
          appUser: APP_USER,
        });

        source = createDataSource(databaseName, migrationsNamed(executedNames));
        await source.initialize();
        await source.runMigrations({ transaction: 'each' });
        await source.destroy();

        source = createDataSource(
          databaseName,
          DATABASE_MIGRATIONS as unknown as readonly MigrationClass[],
        );
        await source.initialize();
        await source.runMigrations({ transaction: 'each' });
        await expect(
          source.runMigrations({ transaction: 'each' }),
        ).resolves.toEqual([]);

        const tables = (await source.query(`SELECT TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (
            'homepage_drafts',
            'wechat_credential_uses',
            'admin_login_verification_buckets',
            'cloud_printers',
            'admin_operation_idempotency'
          )
        ORDER BY TABLE_NAME`)) as Array<{ TABLE_NAME: string }>;
        expect(tables.map(({ TABLE_NAME }) => TABLE_NAME)).toEqual([
          'admin_login_verification_buckets',
          'admin_operation_idempotency',
          'cloud_printers',
          'homepage_drafts',
          'wechat_credential_uses',
        ]);

        const columns = (await source.query(`SELECT TABLE_NAME, COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND ((TABLE_NAME = 'users' AND COLUMN_NAME IN ('is_active', 'merged_into_user_id', 'token_version'))
            OR (TABLE_NAME = 'admin_users' AND COLUMN_NAME IN ('role', 'linked_user_id', 'must_change_password', 'token_version'))
            OR (TABLE_NAME = 'homepage_pages' AND COLUMN_NAME IN ('published_draft_id', 'published_draft_version')))
        ORDER BY TABLE_NAME, COLUMN_NAME`)) as Array<{
          TABLE_NAME: string;
          COLUMN_NAME: string;
        }>;
        expect(columns).toEqual([
          { TABLE_NAME: 'admin_users', COLUMN_NAME: 'linked_user_id' },
          { TABLE_NAME: 'admin_users', COLUMN_NAME: 'must_change_password' },
          { TABLE_NAME: 'admin_users', COLUMN_NAME: 'role' },
          { TABLE_NAME: 'admin_users', COLUMN_NAME: 'token_version' },
          { TABLE_NAME: 'homepage_pages', COLUMN_NAME: 'published_draft_id' },
          {
            TABLE_NAME: 'homepage_pages',
            COLUMN_NAME: 'published_draft_version',
          },
          { TABLE_NAME: 'users', COLUMN_NAME: 'is_active' },
          { TABLE_NAME: 'users', COLUMN_NAME: 'merged_into_user_id' },
          { TABLE_NAME: 'users', COLUMN_NAME: 'token_version' },
        ]);

        const migrationRows = (await source.query(
          `SELECT name, COUNT(*) AS count
         FROM migrations
         WHERE name IN (?, ?, ?)
         GROUP BY name
         ORDER BY name`,
          [...FINAL_NAMES],
        )) as Array<{ name: string; count: string | number }>;
        expect(
          migrationRows.map(({ name, count }) => ({
            name,
            count: Number(count),
          })),
        ).toEqual([...FINAL_NAMES].sort().map((name) => ({ name, count: 1 })));
      },
      60_000,
    );
  },
);
