import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { DataSource, type QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as entities from '../src/database/entities/index.js';
import { UserAdminIdentity1718000000009 } from '../src/database/migrations/0011-user-admin-identity.js';
import { migrationsThrough } from '../src/database/migrations/index.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const MIGRATIONS_0009 = migrationsThrough('HomepagePages1718000000008');
const MIGRATIONS_0010 = migrationsThrough('UserAdminIdentity1718000000009');
const rootSql = createDockerRootSqlExecutor();

const createDatabaseName = (): string =>
  `bake_mall_identity_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;

const createDataSource = (
  database: string,
  migrations = MIGRATIONS_0010,
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
    entities: Object.values(entities),
    migrations: [...migrations],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
  });

type SchemaSnapshot = {
  tables: unknown[];
  columns: unknown[];
  indexes: unknown[];
  checks: unknown[];
  foreignKeys: unknown[];
  users: unknown[];
  adminUsers: unknown[];
  auditLogs: unknown[];
  wechatUses: unknown[] | null;
  adminLoginVerificationBuckets: unknown[] | null;
};

const readSnapshot = async (source: DataSource): Promise<SchemaSnapshot> => {
  const tables = await source.query(`SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('users', 'admin_users', 'admin_login_verification_buckets', 'audit_logs', 'wechat_credential_uses')
    ORDER BY TABLE_NAME`);
  const columns =
    await source.query(`SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION,
      COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('users', 'admin_users', 'admin_login_verification_buckets', 'audit_logs', 'wechat_credential_uses')
    ORDER BY TABLE_NAME, ORDINAL_POSITION`);
  const indexes = await source.query(`SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
      SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('users', 'admin_users', 'admin_login_verification_buckets', 'audit_logs', 'wechat_credential_uses')
    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`);
  const checks = await source.query(`SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME,
      LOWER(REPLACE(cc.CHECK_CLAUSE, '\\\\', '')) AS CHECK_CLAUSE
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.CHECK_CONSTRAINTS cc
      ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
     AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
      AND tc.TABLE_NAME IN ('users', 'admin_users', 'audit_logs', 'wechat_credential_uses')
    ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME`);
  const foreignKeys =
    await source.query(`SELECT k.TABLE_NAME, k.CONSTRAINT_NAME,
      k.ORDINAL_POSITION, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
      k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.TABLE_NAME = k.TABLE_NAME
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE()
      AND k.TABLE_NAME IN ('users', 'admin_users', 'audit_logs', 'wechat_credential_uses')
    ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`);
  const [{ present }] = (await source.query(`SELECT EXISTS(
      SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wechat_credential_uses'
    ) AS present`)) as Array<{ present: number }>;
  const [{ adminLoginVerificationBucketsPresent }] =
    (await source.query(`SELECT EXISTS(
      SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_login_verification_buckets'
    ) AS adminLoginVerificationBucketsPresent`)) as Array<{
      adminLoginVerificationBucketsPresent: number;
    }>;

  return {
    tables,
    columns,
    indexes,
    checks,
    foreignKeys,
    users: await source.query('SELECT * FROM `users` ORDER BY `id`'),
    adminUsers: await source.query('SELECT * FROM `admin_users` ORDER BY `id`'),
    auditLogs: await source.query('SELECT * FROM `audit_logs` ORDER BY `id`'),
    wechatUses:
      Number(present) === 1
        ? await source.query(
            'SELECT * FROM `wechat_credential_uses` ORDER BY `id`',
          )
        : null,
    adminLoginVerificationBuckets:
      Number(adminLoginVerificationBucketsPresent) === 1
        ? await source.query(
            'SELECT * FROM `admin_login_verification_buckets` ORDER BY `bucket_id`',
          )
        : null,
  };
};

const withoutUpdatedAt = (rows: unknown[]): unknown[] =>
  rows.map((rawRow) => {
    if (typeof rawRow !== 'object' || rawRow === null) {
      throw new TypeError('expected database row object');
    }
    const row = { ...rawRow } as Record<string, unknown>;
    delete row.updated_at;
    return row;
  });

const timestampOf = (rawRow: unknown): number => {
  if (typeof rawRow !== 'object' || rawRow === null) {
    return Number.NaN;
  }
  const value = (rawRow as Record<string, unknown>).updated_at;
  return value instanceof Date ? value.getTime() : Date.parse(String(value));
};

const countDdl = (sql: string): boolean =>
  /^\s*(?:ALTER|CREATE|DROP)\s/i.test(sql);

const failAtDdlBoundary = (
  runner: QueryRunner,
  boundary: number,
): (() => void) => {
  const realQuery = runner.query.bind(runner);
  let ddlCount = 0;
  runner.query = async <T = unknown>(
    sql: string,
    parameters?: unknown[],
  ): Promise<T> => {
    if (countDdl(sql)) {
      ddlCount += 1;
      if (ddlCount === boundary) {
        throw new Error(`injected DDL failure at boundary ${boundary}`);
      }
    }
    return realQuery(sql, parameters) as Promise<T>;
  };
  return () => {
    runner.query = realQuery;
  };
};

describe.sequential('User/admin identity migration on MySQL 8.4', () => {
  let databaseName: string;
  let cleanupDatabase: (() => void) | undefined;
  let source: DataSource | undefined;
  let previousMaintenanceMode: string | undefined;
  let previousWritersStopped: string | undefined;

  beforeEach(async () => {
    previousMaintenanceMode = process.env.BAKE_MALL_MAINTENANCE_MODE;
    previousWritersStopped = process.env.BAKE_MALL_IDENTITY_WRITERS_STOPPED;
    databaseName = createDatabaseName();
    cleanupDatabase = provisionMysqlTestDatabase(rootSql, {
      databaseName,
      appUser: APP_USER,
    });
    source = createDataSource(databaseName, MIGRATIONS_0009);
    await source.initialize();
    await source.runMigrations();
    process.env.BAKE_MALL_MAINTENANCE_MODE = '1';
    process.env.BAKE_MALL_IDENTITY_WRITERS_STOPPED = '1';
  }, 60_000);

  afterEach(async () => {
    if (previousMaintenanceMode === undefined) {
      delete process.env.BAKE_MALL_MAINTENANCE_MODE;
    } else {
      process.env.BAKE_MALL_MAINTENANCE_MODE = previousMaintenanceMode;
    }
    if (previousWritersStopped === undefined) {
      delete process.env.BAKE_MALL_IDENTITY_WRITERS_STOPPED;
    } else {
      process.env.BAKE_MALL_IDENTITY_WRITERS_STOPPED = previousWritersStopped;
    }
    try {
      if (source?.isInitialized) await source.destroy();
    } finally {
      cleanupDatabase?.();
    }
    expect(
      mysqlTestDatabaseState(rootSql, {
        databaseName,
        appUser: APP_USER,
      }),
    ).toEqual({ schemaCount: 0, grantCount: 0 });
  });

  it('从 0009 升级到 0010 后在无域数据时精确恢复关键 schema 与旧数据', async () => {
    await source!.query(
      "INSERT INTO `users` (`phone`, `phone_verified`) VALUES ('13900000910', 1)",
    );
    const { insertId: adminId } = (await source!.query(
      `INSERT INTO \`admin_users\`
       (\`username\`, \`password_hash\`, \`created_at\`, \`updated_at\`)
       VALUES ('identity-admin', 'hash', '2020-01-01 00:00:00', '2020-01-01 00:00:00')`,
    )) as { insertId: string | number };
    await source!.query(
      "INSERT INTO `audit_logs` (`admin_user_id`, `target_entity`, `target_id`, `action`) VALUES (?, 'migration', '0010', 'BASELINE')",
      [String(adminId)],
    );
    const baseline = await readSnapshot(source!);

    await source!.destroy();
    source = createDataSource(databaseName, MIGRATIONS_0010);
    await source.initialize();
    await source.runMigrations({ transaction: 'each' });
    const upgraded = await readSnapshot(source!);
    expect(upgraded.wechatUses).toEqual([]);
    expect(upgraded.adminLoginVerificationBuckets).toHaveLength(1024);
    expect(
      upgraded.adminLoginVerificationBuckets?.map((row) =>
        Number((row as { bucket_id: unknown }).bucket_id),
      ),
    ).toEqual(Array.from({ length: 1024 }, (_, index) => index));
    expect(
      upgraded.columns
        .filter(
          (rawRow) =>
            (rawRow as { TABLE_NAME: unknown }).TABLE_NAME ===
            'admin_login_verification_buckets',
        )
        .map((rawRow) => (rawRow as { COLUMN_NAME: unknown }).COLUMN_NAME),
    ).toEqual(['bucket_id', 'failed_count', 'window_started_at', 'updated_at']);
    expect(
      upgraded.indexes
        .filter(
          (rawRow) =>
            (rawRow as { TABLE_NAME: unknown }).TABLE_NAME ===
            'admin_login_verification_buckets',
        )
        .map((rawRow) => ({
          name: (rawRow as { INDEX_NAME: unknown }).INDEX_NAME,
          column: (rawRow as { COLUMN_NAME: unknown }).COLUMN_NAME,
          unique: Number((rawRow as { NON_UNIQUE: unknown }).NON_UNIQUE) === 0,
        })),
    ).toEqual([{ name: 'PRIMARY', column: 'bucket_id', unique: true }]);

    await source!.undoLastMigration({ transaction: 'each' });

    const restored = await readSnapshot(source!);
    expect({
      ...restored,
      adminUsers: withoutUpdatedAt(restored.adminUsers),
    }).toEqual({
      ...baseline,
      adminUsers: withoutUpdatedAt(baseline.adminUsers),
    });

    // 0010 role backfill is a real UPDATE, so MySQL's legacy ON UPDATE column
    // may advance. It remains valid and monotonic; migration down must not
    // fabricate the prior auto-maintained timestamp.
    expect(restored.adminUsers).toHaveLength(1);
    expect(baseline.adminUsers).toHaveLength(1);
    expect(withoutUpdatedAt(restored.adminUsers)).toEqual([
      {
        id: String(adminId),
        username: 'identity-admin',
        password_hash: 'hash',
        is_active: 1,
        created_at: new Date('2020-01-01T00:00:00.000Z'),
      },
    ]);
    const restoredUpdatedAt = timestampOf(restored.adminUsers[0]);
    const baselineUpdatedAt = timestampOf(baseline.adminUsers[0]);
    expect(Number.isFinite(restoredUpdatedAt)).toBe(true);
    expect(restoredUpdatedAt).toBeGreaterThanOrEqual(baselineUpdatedAt);
  });

  it.each([
    ['OPERATOR'],
    ['ADMIN_IDENTITY_STATE'],
    ['BUCKET_FAILED_COUNT'],
    ['BUCKET_WINDOW_STARTED_AT'],
    ['USER_TOMBSTONE'],
    ['WECHAT_USE'],
    ['USER_AUDIT'],
    ['SYSTEM_AUDIT'],
  ] as const)(
    'guard %s 拒绝 down 且完整 schema/数据快照不变',
    async (fixture) => {
      await source!.destroy();
      source = createDataSource(databaseName, MIGRATIONS_0010);
      await source.initialize();
      await source.runMigrations({ transaction: 'each' });

      if (fixture === 'OPERATOR') {
        const { insertId: userId } = (await source!.query(
          "INSERT INTO `users` (`phone`, `phone_verified`) VALUES ('13900000911', 1)",
        )) as { insertId: string | number };
        await source!.query(
          "INSERT INTO `admin_users` (`username`, `role`, `linked_user_id`, `password_hash`) VALUES (NULL, 'OPERATOR', ?, 'hash')",
          [String(userId)],
        );
      } else if (fixture === 'ADMIN_IDENTITY_STATE') {
        await source!.query(
          `INSERT INTO \`admin_users\`
          (\`username\`, \`role\`, \`password_hash\`, \`must_change_password\`, \`token_version\`,
           \`verify_failed_count\`, \`verify_window_started_at\`, \`last_password_changed_at\`)
         VALUES ('identity-state-admin', 'SUPER_ADMIN', 'hash', 1, 2, 3,
                 '2026-08-04 00:00:00', '2026-08-04 00:00:01')`,
        );
      } else if (fixture === 'BUCKET_FAILED_COUNT') {
        await source!.query(
          `UPDATE \`admin_login_verification_buckets\`
           SET \`failed_count\` = 1
           WHERE \`bucket_id\` = 0`,
        );
      } else if (fixture === 'BUCKET_WINDOW_STARTED_AT') {
        await source!.query(
          `UPDATE \`admin_login_verification_buckets\`
           SET \`window_started_at\` = '2026-08-04 00:00:00'
           WHERE \`bucket_id\` = 0`,
        );
      } else if (fixture === 'USER_TOMBSTONE') {
        await source!.query(
          "INSERT INTO `users` (`phone`, `phone_verified`, `is_active`, `token_version`) VALUES ('13900000912', 1, 0, 2)",
        );
      } else if (fixture === 'WECHAT_USE') {
        await source!.query(
          `INSERT INTO \`wechat_credential_uses\`
          (\`kind\`, \`credential_hash\`, \`status\`, \`expires_at\`)
         VALUES ('LOGIN', ?, 'IN_PROGRESS', '2027-01-01 00:00:00')`,
          ['a'.repeat(64)],
        );
      } else if (fixture === 'USER_AUDIT') {
        const { insertId: userId } = (await source!.query(
          "INSERT INTO `users` (`phone`, `phone_verified`) VALUES ('13900000913', 1)",
        )) as { insertId: string | number };
        await source!.query(
          `INSERT INTO \`audit_logs\`
          (\`actor_type\`, \`admin_user_id\`, \`user_id\`, \`target_entity\`, \`target_id\`, \`action\`)
         VALUES ('USER', NULL, ?, 'identity', 'guard', 'TEST')`,
          [String(userId)],
        );
      } else {
        await source!.query(
          `INSERT INTO \`audit_logs\`
          (\`actor_type\`, \`admin_user_id\`, \`user_id\`, \`target_entity\`, \`target_id\`, \`action\`)
         VALUES ('SYSTEM', NULL, NULL, 'identity', 'guard', 'TEST')`,
        );
      }
      const before = await readSnapshot(source!);

      await expect(
        source!.undoLastMigration({ transaction: 'each' }),
      ).rejects.toThrow(/cannot revert|无法回滚/i);

      expect(await readSnapshot(source!)).toEqual(before);
    },
  );

  it.each([
    [
      '缺少 PRIMARY',
      'ALTER TABLE `admin_login_verification_buckets` DROP PRIMARY KEY',
    ],
    [
      'engine 不是 InnoDB',
      'ALTER TABLE `admin_login_verification_buckets` ENGINE=MyISAM',
    ],
    [
      'updated_at 缺少 ON UPDATE',
      `ALTER TABLE \`admin_login_verification_buckets\`
       MODIFY COLUMN \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    ],
    [
      '存在额外二级索引',
      'ALTER TABLE `admin_login_verification_buckets` ADD INDEX `idx_bucket_failed_count` (`failed_count`)',
    ],
  ] as const)(
    'up 在 bucket 表%s时于任何 DDL/DML 前拒绝',
    async (_case, driftSql) => {
      await source!.destroy();
      source = createDataSource(databaseName, MIGRATIONS_0010);
      await source.initialize();
      await source.runMigrations({ transaction: 'each' });
      await source.query(driftSql);

      const migration = new UserAdminIdentity1718000000009();
      const runner = source!.createQueryRunner();
      await runner.connect();
      const realQuery = runner.query.bind(runner);
      const statements: string[] = [];
      runner.query = async <T = unknown>(
        sql: string,
        parameters?: unknown[],
      ): Promise<T> => {
        statements.push(sql);
        return realQuery(sql, parameters) as Promise<T>;
      };
      try {
        await expect(migration.up(runner)).rejects.toThrow(
          /schema state|状态/i,
        );
        expect(statements).toHaveLength(1);
        expect(statements[0]).toContain('identity-schema-state');
      } finally {
        runner.query = realQuery;
        await runner.release();
      }
    },
    60_000,
  );

  it('up 在每个 DDL 边界失败后可由第二次运行恢复到 0010', async () => {
    const migration = new UserAdminIdentity1718000000009();
    const runner = source!.createQueryRunner();
    await runner.connect();
    try {
      for (let boundary = 1; boundary <= 8; boundary += 1) {
        const restore = failAtDdlBoundary(runner, boundary);
        await expect(migration.up(runner)).rejects.toThrow(
          `injected DDL failure at boundary ${boundary}`,
        );
        restore();
        await migration.up(runner);
        const upgraded = await readSnapshot(source!);
        expect(upgraded.wechatUses).toEqual([]);
        expect(upgraded.adminLoginVerificationBuckets).toHaveLength(1024);
        await migration.down(runner);
      }
    } finally {
      await runner.release();
    }
  }, 60_000);

  it('down 在每个 DDL 边界失败后可由第二次运行恢复到 0009', async () => {
    const migration = new UserAdminIdentity1718000000009();
    const runner = source!.createQueryRunner();
    await runner.connect();
    try {
      const baseline = await readSnapshot(source!);
      for (let boundary = 1; boundary <= 13; boundary += 1) {
        await migration.up(runner);
        const restore = failAtDdlBoundary(runner, boundary);
        await expect(migration.down(runner)).rejects.toThrow(
          `injected DDL failure at boundary ${boundary}`,
        );
        restore();
        await migration.down(runner);
        expect(await readSnapshot(source!)).toEqual(baseline);
      }
    } finally {
      await runner.release();
    }
  }, 60_000);
});
