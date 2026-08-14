import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { DataSource, type QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as entities from '../src/database/entities/index.js';
import { migrationsThrough } from '../src/database/migrations/index.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const MIGRATIONS_0011 = migrationsThrough('CloudPrinters1718000000010');
const CloudPrintJobs1718000000011 = migrationsThrough(
  'CloudPrintJobs1718000000011',
).at(-1)!;
const MIGRATION_LOCK = 'bake-mall:migration:0012-cloud-print-jobs';
const STAGING_BATCHES = '__0012_print_batches_staging';
const STAGING_JOBS = '__0012_print_jobs_staging';
const rootSql = createDockerRootSqlExecutor();
const createDatabaseName = (): string =>
  `bake_mall_print_jobs_migration_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;

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
    migrations: [...MIGRATIONS_0011],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
  });

type TableRow = { table_name: string };
type ForeignKeyRow = {
  constraint_name: string;
  table_name: string;
  referenced_table_name: string;
};
type LockRow = { lock_acquired: number | string };

const printingTables = async (source: DataSource): Promise<string[]> => {
  const rows = (await source.query(
    `SELECT TABLE_NAME AS \`table_name\`
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (?, ?, 'print_batches', 'print_jobs')
     ORDER BY TABLE_NAME`,
    [STAGING_BATCHES, STAGING_JOBS],
  )) as TableRow[];
  return rows.map(({ table_name }) => table_name);
};

const connectedRunner = async (source: DataSource): Promise<QueryRunner> => {
  const runner = source.createQueryRunner();
  await runner.connect();
  return runner;
};

const acquireLock = async (runner: QueryRunner): Promise<number> => {
  const [row] = (await runner.query(
    `SELECT GET_LOCK(?, 0) AS \`lock_acquired\``,
    [MIGRATION_LOCK],
  )) as LockRow[];
  return Number(row?.lock_acquired);
};

const releaseLock = async (runner: QueryRunner): Promise<void> => {
  await runner.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK]);
};

describe.sequential('0012 cloud print jobs migration on MySQL 8.4', () => {
  let databaseName: string;
  let cleanupDatabase: (() => void) | undefined;
  let source: DataSource | undefined;
  let previousMaintenanceMode: string | undefined;
  let previousWritersStopped: string | undefined;

  beforeEach(async () => {
    previousMaintenanceMode = process.env.BAKE_MALL_MAINTENANCE_MODE;
    previousWritersStopped = process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED;
    process.env.BAKE_MALL_MAINTENANCE_MODE = '1';
    process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED = '1';

    databaseName = createDatabaseName();
    cleanupDatabase = provisionMysqlTestDatabase(rootSql, {
      databaseName,
      appUser: APP_USER,
    });
    source = createDataSource(databaseName);
    await source.initialize();
    await source.runMigrations();
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
      source = undefined;
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

  it('fresh up 后所有 FK 均引用最终 print_batches/print_jobs 表', async () => {
    await new CloudPrintJobs1718000000011().up(source!.createQueryRunner());

    const foreignKeys = (await source!.query(
      `SELECT CONSTRAINT_NAME AS \`constraint_name\`,
              TABLE_NAME AS \`table_name\`,
              REFERENCED_TABLE_NAME AS \`referenced_table_name\`
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE CONSTRAINT_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('print_batches', 'print_jobs')
         AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
    )) as ForeignKeyRow[];

    expect(await printingTables(source!)).toEqual([
      'print_batches',
      'print_jobs',
    ]);
    expect(foreignKeys).toEqual([
      {
        constraint_name: 'fk_print_batches_created_by_admin',
        table_name: 'print_batches',
        referenced_table_name: 'admin_users',
      },
      {
        constraint_name: 'fk_print_batches_printer',
        table_name: 'print_batches',
        referenced_table_name: 'cloud_printers',
      },
      {
        constraint_name: 'fk_print_jobs_batch',
        table_name: 'print_jobs',
        referenced_table_name: 'print_batches',
      },
      {
        constraint_name: 'fk_print_jobs_created_by_admin',
        table_name: 'print_jobs',
        referenced_table_name: 'admin_users',
      },
      {
        constraint_name: 'fk_print_jobs_manual_resolution_admin',
        table_name: 'print_jobs',
        referenced_table_name: 'admin_users',
      },
      {
        constraint_name: 'fk_print_jobs_order',
        table_name: 'print_jobs',
        referenced_table_name: 'orders',
      },
      {
        constraint_name: 'fk_print_jobs_printer',
        table_name: 'print_jobs',
        referenced_table_name: 'cloud_printers',
      },
      {
        constraint_name: 'fk_print_jobs_supersedes',
        table_name: 'print_jobs',
        referenced_table_name: 'print_jobs',
      },
    ]);
  });

  it('第二张 staging create 故障后不暴露最终表，释放锁并可安全重跑', async () => {
    const runner = await connectedRunner(source!);
    const realQuery = runner.query.bind(runner);
    let failSecondCreate = true;
    runner.query = async (sql: string, parameters?: unknown[]) => {
      if (
        failSecondCreate &&
        sql.includes(`CREATE TABLE \`${STAGING_JOBS}\``)
      ) {
        failSecondCreate = false;
        throw new Error('forced second staging create failure');
      }
      return realQuery(sql, parameters);
    };

    await expect(new CloudPrintJobs1718000000011().up(runner)).rejects.toThrow(
      /forced second staging create failure/iu,
    );
    expect(await printingTables(source!)).toEqual([STAGING_BATCHES]);

    const lockProbe = await connectedRunner(source!);
    try {
      await expect(acquireLock(lockProbe)).resolves.toBe(1);
      await releaseLock(lockProbe);
    } finally {
      await lockProbe.release();
    }

    await expect(
      new CloudPrintJobs1718000000011().up(runner),
    ).resolves.toBeUndefined();
    expect(await printingTables(source!)).toEqual([
      'print_batches',
      'print_jobs',
    ]);
    await runner.release();
  });

  it('空表 down 后 print_batches 与 print_jobs 同时消失', async () => {
    const migration = new CloudPrintJobs1718000000011();
    const runner = await connectedRunner(source!);
    try {
      await migration.up(runner);
      await migration.down(runner);
      expect(await printingTables(source!)).toEqual([]);
    } finally {
      await runner.release();
    }
  });

  it('存在最小打印域数据时 down 拒绝且双表保留', async () => {
    const migration = new CloudPrintJobs1718000000011();
    const runner = await connectedRunner(source!);
    try {
      await migration.up(runner);
      const admin = (await source!.query(
        `INSERT INTO admin_users
         (username, password_hash, role, is_active, must_change_password,
          token_version, verify_failed_count, created_at, updated_at)
         VALUES (?, 'not-used', 'SUPER_ADMIN', 1, 0, 1, 0,
                 UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        ['print-jobs-down-guard@example.com'],
      )) as { insertId: number };
      const printer = (await source!.query(
        `INSERT INTO cloud_printers
         (serial_number, display_name, status, bound_by_admin_id)
         VALUES ('SN-PRINT-JOBS-DOWN', 'down guard', 'ACTIVE', ?)`,
        [String(admin.insertId)],
      )) as { insertId: number };
      await source!.query(
        `INSERT INTO print_batches (printer_id, created_by_admin_id)
         VALUES (?, ?)`,
        [String(printer.insertId), String(admin.insertId)],
      );

      await expect(migration.down(runner)).rejects.toThrow(
        /cannot revert|无法回滚/iu,
      );
      expect(await printingTables(source!)).toEqual([
        'print_batches',
        'print_jobs',
      ]);
    } finally {
      await runner.release();
    }
  });

  it('两个连接对 0012 advisory lock 互斥且 up 完成后锁可再次获取', async () => {
    const migrationRunner = await connectedRunner(source!);
    const contender = await connectedRunner(source!);
    const realQuery = migrationRunner.query.bind(migrationRunner);
    let migrationHasLock!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      migrationHasLock = resolve;
    });
    let continueMigration!: () => void;
    const migrationMayContinue = new Promise<void>((resolve) => {
      continueMigration = resolve;
    });
    migrationRunner.query = async (sql: string, parameters?: unknown[]) => {
      const result = await realQuery(sql, parameters);
      if (sql.includes('GET_LOCK')) {
        migrationHasLock();
        await migrationMayContinue;
      }
      return result;
    };

    const up = new CloudPrintJobs1718000000011().up(migrationRunner);
    await lockHeld;
    try {
      await expect(acquireLock(contender)).resolves.toBe(0);
    } finally {
      continueMigration();
    }
    await up;
    await expect(acquireLock(contender)).resolves.toBe(1);
    await releaseLock(contender);
    await migrationRunner.release();
    await contender.release();
  });
});
