import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdminOperationIdempotency } from '../src/database/entities/admin-operation-idempotency.entity.js';
import * as entities from '../src/database/entities/index.js';
import { CloudPrinters1718000000010 } from '../src/database/migrations/0012-cloud-printers.js';
import { migrationsThrough } from '../src/database/migrations/index.js';
import { createAdminOperationIdempotencyTestService } from './helpers/admin-operation-idempotency.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const MIGRATIONS_0010 = migrationsThrough('UserAdminIdentity1718000000009');
const rootSql = createDockerRootSqlExecutor();
const createDatabaseName = (): string =>
  `bake_mall_printing_migration_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;

const createDataSource = (database: string): DataSource =>
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
    migrations: [...MIGRATIONS_0010],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
  });

describe.sequential('Cloud printers migration on MySQL 8.4', () => {
  let databaseName: string;
  let cleanupDatabase: (() => void) | undefined;
  let source: DataSource | undefined;
  let previousMaintenanceMode: string | undefined;
  let previousWritersStopped: string | undefined;

  beforeEach(async () => {
    previousMaintenanceMode = process.env.BAKE_MALL_MAINTENANCE_MODE;
    previousWritersStopped = process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED;
    databaseName = createDatabaseName();
    cleanupDatabase = provisionMysqlTestDatabase(rootSql, {
      databaseName,
      appUser: APP_USER,
    });
    source = createDataSource(databaseName);
    await source.initialize();
    await source.runMigrations();
    await new CloudPrinters1718000000010().up(source.createQueryRunner());
    process.env.BAKE_MALL_MAINTENANCE_MODE = '1';
    process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED = '1';
  }, 60_000);

  afterEach(async () => {
    if (previousMaintenanceMode === undefined) {
      delete process.env.BAKE_MALL_MAINTENANCE_MODE;
    } else {
      process.env.BAKE_MALL_MAINTENANCE_MODE = previousMaintenanceMode;
    }
    if (previousWritersStopped === undefined) {
      delete process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED;
    } else {
      process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED = previousWritersStopped;
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
  }, 60_000);

  it('创建 binding operation FK/index 且能引用同 migration 中的幂等记录', async () => {
    const adminResult = (await source!.query(
      `INSERT INTO admin_users
      (username, password_hash, role, is_active, must_change_password, token_version,
       verify_failed_count, created_at, updated_at)
      VALUES (?, ?, 'SUPER_ADMIN', 1, 0, 1, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      ['binding-operation-fk@example.com', 'not-used'],
    )) as { insertId: number };
    const operationResult = (await source!.query(
      `INSERT INTO admin_operation_idempotency
       (admin_id, operation, \`key\`, request_hash, status)
       VALUES (?, 'CLOUD_PRINTER_BIND', ?, ?, 'UNKNOWN')`,
      [
        String(adminResult.insertId),
        '00000000-0000-4000-8000-000000000211',
        'a'.repeat(64),
      ],
    )) as { insertId: number };

    await source!.query(
      `INSERT INTO cloud_printers
       (serial_number, display_name, status, binding_operation_id, bound_by_admin_id)
       VALUES ('SN-Operation-FK', 'operation-fk', 'ERROR', ?, ?)`,
      [String(operationResult.insertId), String(adminResult.insertId)],
    );
    const foreignKeys = (await source!.query(`SELECT CONSTRAINT_NAME
      FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cloud_printers'
        AND REFERENCED_TABLE_NAME = 'admin_operation_idempotency'`)) as Array<{
      CONSTRAINT_NAME: string;
    }>;
    expect(foreignKeys).toEqual([
      { CONSTRAINT_NAME: 'fk_cloud_printers_binding_operation' },
    ]);
    await expect(
      source!.query(
        `UPDATE cloud_printers SET binding_operation_id = 18446744073709551615
         WHERE serial_number = 'SN-Operation-FK'`,
      ),
    ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
  });

  it('继承表级 utf8mb4 collation 且不存在 owner hash 列', async () => {
    const columns = (await source!.query(`SELECT TABLE_NAME, COLUMN_NAME,
      CHARACTER_SET_NAME, COLLATION_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = 'cloud_printers' AND COLUMN_NAME = 'serial_number')
          OR (TABLE_NAME = 'admin_operation_idempotency'
            AND COLUMN_NAME IN ('request_hash', 'owner_token_hash')))
      ORDER BY TABLE_NAME, COLUMN_NAME`)) as Array<Record<string, unknown>>;

    expect(columns).toEqual([
      expect.objectContaining({
        TABLE_NAME: 'admin_operation_idempotency',
        COLUMN_NAME: 'request_hash',
        CHARACTER_SET_NAME: 'utf8mb4',
        COLLATION_NAME: 'utf8mb4_unicode_ci',
      }),
      expect.objectContaining({
        TABLE_NAME: 'cloud_printers',
        COLUMN_NAME: 'serial_number',
        CHARACTER_SET_NAME: 'utf8mb4',
        COLLATION_NAME: 'utf8mb4_unicode_ci',
      }),
    ]);
  });

  it('入口拒绝 uppercase UUID 且两个不同 lowercase UUID 各自成为 OWNER', async () => {
    const adminResult = (await source!.query(
      `INSERT INTO admin_users
      (username, password_hash, role, is_active, must_change_password, token_version,
       verify_failed_count, created_at, updated_at)
      VALUES (?, ?, 'SUPER_ADMIN', 1, 0, 1, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      ['uuid-entry@example.com', 'not-used'],
    )) as { insertId: number };
    const repository = source!.getRepository(AdminOperationIdempotency);
    const service = createAdminOperationIdempotencyTestService(repository);
    const manager = { getRepository: () => repository };
    const baseInput = {
      adminId: String(adminResult.insertId),
      operation: 'CLOUD_PRINTER_BIND',
      request: { serialNumber: 'SN-UUID-ENTRY' },
    } as const;

    await expect(
      service.claim(manager, {
        ...baseInput,
        key: '00000000-0000-4000-8000-00000000000A',
      }),
    ).rejects.toThrow(/canonical|lowercase|UUID/iu);
    await expect(repository.count()).resolves.toBe(0);

    const first = await service.claim(manager, {
      ...baseInput,
      key: '00000000-0000-4000-8000-000000000201',
    });
    const second = await service.claim(manager, {
      ...baseInput,
      key: '00000000-0000-4000-8000-000000000202',
    });

    expect(first.kind).toBe('OWNER');
    expect(second.kind).toBe('OWNER');
    await expect(repository.count()).resolves.toBe(2);
  });

  it.each(['cloud_printers', 'admin_operation_idempotency'] as const)(
    'down 在 %s 有域数据时于 DDL 前拒绝、schema 不变并释放锁',
    async (populatedTable) => {
      const adminResult = (await source!.query(
        `INSERT INTO admin_users
        (username, password_hash, role, is_active, must_change_password, token_version,
         verify_failed_count, created_at, updated_at)
        VALUES (?, ?, 'SUPER_ADMIN', 1, 0, 1, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [`down-guard-${populatedTable}@example.com`, 'not-used'],
      )) as { insertId: number };
      if (populatedTable === 'cloud_printers') {
        await source!.query(
          `INSERT INTO cloud_printers
           (serial_number, display_name, status, bound_by_admin_id)
           VALUES (?, 'guard', 'BINDING', ?)`,
          [`SN-Down-Guard-${populatedTable}`, String(adminResult.insertId)],
        );
      } else {
        await source!.query(
          `INSERT INTO admin_operation_idempotency
           (admin_id, operation, \`key\`, request_hash, status)
           VALUES (?, 'CLOUD_PRINTER_BIND', ?, ?, 'FAILED')`,
          [
            String(adminResult.insertId),
            '00000000-0000-4000-8000-000000000213',
            'b'.repeat(64),
          ],
        );
      }
      const before = (await source!.query(`SELECT TABLE_NAME, COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('cloud_printers', 'admin_operation_idempotency')
        ORDER BY TABLE_NAME, ORDINAL_POSITION`)) as Array<
        Record<string, unknown>
      >;
      const runner = source!.createQueryRunner();
      await runner.connect();
      const statements: string[] = [];
      const query = runner.query.bind(runner);
      runner.query = async (sql: string, parameters?: unknown[]) => {
        statements.push(sql);
        return query(sql, parameters);
      };

      await expect(
        new CloudPrinters1718000000010().down(runner),
      ).rejects.toThrow(/cannot revert|无法回滚/iu);

      const after = (await source!.query(`SELECT TABLE_NAME, COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('cloud_printers', 'admin_operation_idempotency')
        ORDER BY TABLE_NAME, ORDINAL_POSITION`)) as Array<
        Record<string, unknown>
      >;
      expect(after).toEqual(before);
      expect(
        statements.some((sql) => /^\s*(?:DROP|ALTER|CREATE)\b/iu.test(sql)),
      ).toBe(false);
      expect(statements.at(-1)).toMatch(/^\s*UNLOCK TABLES\s*$/iu);
      const lockProbe = source!.createQueryRunner();
      await lockProbe.connect();
      await expect(
        lockProbe.query('LOCK TABLES `cloud_printers` READ'),
      ).resolves.toBeDefined();
      await lockProbe.query('UNLOCK TABLES');
      await lockProbe.release();
      await runner.release();
    },
    30_000,
  );

  it('down 持有两表 WRITE lock 时并发 writer 被阻塞且不会在检查后插入', async () => {
    const adminResult = (await source!.query(
      `INSERT INTO admin_users
      (username, password_hash, role, is_active, must_change_password, token_version,
       verify_failed_count, created_at, updated_at)
      VALUES (?, ?, 'SUPER_ADMIN', 1, 0, 1, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      ['migration-writer@example.com', 'not-used'],
    )) as { insertId: number };
    const downRunner = source!.createQueryRunner();
    const writerRunner = source!.createQueryRunner();
    await downRunner.connect();
    await writerRunner.connect();
    const migration = new CloudPrinters1718000000010();
    const realQuery = downRunner.query.bind(downRunner);
    let releasePreflight!: () => void;
    const preflightReached = new Promise<void>((resolve) => {
      releasePreflight = resolve;
    });
    let continueDown!: () => void;
    const downMayContinue = new Promise<void>((resolve) => {
      continueDown = resolve;
    });
    downRunner.query = async (sql: string, parameters?: unknown[]) => {
      const result = await realQuery(sql, parameters);
      if (
        sql.includes('admin_operation_idempotency') &&
        sql.includes('SELECT EXISTS')
      ) {
        releasePreflight();
        await downMayContinue;
      }
      return result;
    };

    const down = migration.down(downRunner);
    await preflightReached;
    let writerSettled = false;
    const writer = writerRunner
      .query(
        `INSERT INTO cloud_printers
          (serial_number, display_name, status, bound_by_admin_id)
         VALUES ('SN-Concurrent-Writer', 'writer', 'BINDING', ?)`,
        [String(adminResult.insertId)],
      )
      .then(() => {
        writerSettled = true;
      })
      .catch(() => {
        writerSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(writerSettled).toBe(false);

    continueDown();
    await down;
    await writer;
    expect(writerSettled).toBe(true);
    const [{ tableCount }] = (await source!.query(`SELECT COUNT(*) AS tableCount
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('cloud_printers', 'admin_operation_idempotency')`)) as Array<{
      tableCount: number;
    }>;
    expect(Number(tableCount)).toBe(0);

    await downRunner.release();
    await writerRunner.release();
  }, 30_000);
});
