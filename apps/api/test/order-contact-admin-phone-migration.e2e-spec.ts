import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as entities from '../src/database/entities/index.js';
import { migrationsThrough } from '../src/database/migrations/index.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_contact_phone_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const MIGRATIONS_0013 = migrationsThrough(
  'PrintJobUnknownMetadata1718000000012',
);
const MIGRATIONS_0014 = migrationsThrough(
  'OrderContactAndAdminLoginPhone1718000000013',
);

describe.sequential(
  'order contact/admin login phone migration (MySQL 8.4)',
  () => {
    const rootSql = createDockerRootSqlExecutor();
    let cleanupDatabase: (() => void) | undefined;
    let source: DataSource | undefined;

    const createSource = (
      migrations: readonly (new () => import('typeorm').MigrationInterface)[],
    ) =>
      new DataSource({
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
        migrations: [...migrations],
        migrationsTableName: 'migrations',
        migrationsTransactionMode: 'each',
      });

    beforeAll(async () => {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      source = createSource(MIGRATIONS_0013);
      await source.initialize();
      await source.runMigrations();
    }, 60_000);

    afterAll(async () => {
      try {
        if (source?.isInitialized) await source.destroy();
      } finally {
        cleanupDatabase?.();
        cleanupDatabase = undefined;
      }
      expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
        schemaCount: 0,
        grantCount: 0,
      });
    });

    it('backfills valid phones and preserves inactive legacy operators without login phones', async () => {
      if (!source)
        throw new Error('Temporary MySQL data source was not initialized');
      const validUser = await source.query(
        "INSERT INTO users (phone, phone_verified) VALUES ('13800000001', 1)",
      );
      const invalidUser = await source.query(
        "INSERT INTO users (phone, phone_verified) VALUES ('legacy-phone', 0)",
      );
      await source.query(
        "INSERT INTO admin_users (username, role, linked_user_id, password_hash, is_active, token_version) VALUES (NULL, 'OPERATOR', ?, 'hash', 1, 4), (NULL, 'OPERATOR', ?, 'hash', 0, 9)",
        [String(validUser.insertId), String(invalidUser.insertId)],
      );

      await source.destroy();
      source = createSource(MIGRATIONS_0014);
      await source.initialize();
      await source.runMigrations({ transaction: 'each' });

      const users = await source.query(
        'SELECT phone, order_contact_phone, order_contact_phone_version FROM users ORDER BY id',
      );
      expect(users).toEqual([
        expect.objectContaining({
          phone: '13800000001',
          order_contact_phone: '13800000001',
          order_contact_phone_version: 1,
        }),
        expect.objectContaining({
          phone: 'legacy-phone',
          order_contact_phone: null,
          order_contact_phone_version: 0,
        }),
      ]);
      const admins = await source.query(
        'SELECT login_phone, is_active, token_version FROM admin_users ORDER BY id',
      );
      expect(admins).toEqual([
        expect.objectContaining({
          login_phone: '13800000001',
          is_active: 1,
          token_version: 4,
        }),
        expect.objectContaining({
          login_phone: null,
          is_active: 0,
          token_version: 9,
        }),
      ]);
    });
  },
);
