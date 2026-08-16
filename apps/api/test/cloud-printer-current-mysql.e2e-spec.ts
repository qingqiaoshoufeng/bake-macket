import 'reflect-metadata';

import {
  AdminRole,
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
} from '@bake-mall/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AdminOperationIdempotency } from '../src/database/entities/admin-operation-idempotency.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import {
  CLOUD_PRINTER_STORE_SCOPE,
  CloudPrinterStoreSetting,
} from '../src/database/entities/cloud-printer-store-setting.entity.js';
import { CloudPrinter } from '../src/database/entities/cloud-printer.entity.js';
import * as entities from '../src/database/entities/index.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { CloudPrinterCurrentService } from '../src/printing/cloud-printer-current.service.js';
import { createAdminOperationIdempotencyTestService } from './helpers/admin-operation-idempotency.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
  resolveMysqlPort,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_current_printer_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const OPERATION_PASSWORD = 'current-printer-test-password';

let keySequence = 800;
const newKey = (): string =>
  `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

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

function dataSourceWithTransactionBarrier(
  source: DataSource,
  connectionIds: number[],
): DataSource {
  const barrier = createBarrier(2);
  return new Proxy(source, {
    get(target, property, receiver) {
      if (property !== 'transaction') {
        return Reflect.get(target, property, receiver);
      }
      return <T>(operation: (manager: EntityManager) => Promise<T>) =>
        target.transaction(async (manager) => {
          const rows = (await manager.query(
            'SELECT CONNECTION_ID() AS id',
          )) as Array<{ id: number | string }>;
          connectionIds.push(Number(rows[0]?.id));
          await barrier.wait();
          return operation(manager);
        });
    },
  });
}

describe.sequential('current cloud printer migration and locking (real MySQL)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let source: DataSource | undefined;
  let admin: AdminUser;
  let printers: readonly [CloudPrinter, CloudPrinter];
  let previousMaintenanceMode: string | undefined;
  let previousWritersStopped: string | undefined;

  const requireDatabase = (): DataSource => {
    if (!source) throw new Error('Temporary MySQL data source is unavailable');
    return source;
  };

  const createService = (dataSource = requireDatabase()) =>
    new CloudPrinterCurrentService(
      dataSource,
      {
        verifyPassword: vi.fn(async () => ({
          status: 'VERIFIED' as const,
          admin: admin as never,
        })),
      } as never,
      new AuditService(dataSource.getRepository(AuditLog)),
      createAdminOperationIdempotencyTestService(
        dataSource.getRepository(AdminOperationIdempotency),
      ),
    );

  const savePrinter = (serialNumber: string): Promise<CloudPrinter> => {
    const repository = requireDatabase().getRepository(CloudPrinter);
    return repository.save(
      repository.create({
        serialNumber,
        displayName: serialNumber,
        status: CloudPrinterStatus.ACTIVE,
        bindingStage: PrinterBindingStage.NONE,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
        bindingIdempotencyKey: null,
        bindingOperationId: null,
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationFailedAttempts: 0,
        verifiedAt: new Date('2026-08-16T00:00:00.000Z'),
        lastOnlineStatus: CloudPrinterOnlineStatus.OFFLINE,
        lastStatusCheckedAt: null,
        boundByAdminId: admin.id,
        lastVendorErrorCode: null,
        unboundAt: null,
      }),
    );
  };

  const resetCurrent = async (revision: number): Promise<void> => {
    await requireDatabase().query(
      `UPDATE cloud_printer_store_settings
       SET current_printer_id = NULL, revision = ?, updated_by_admin_id = NULL
       WHERE scope_key = ?`,
      [revision, CLOUD_PRINTER_STORE_SCOPE],
    );
  };

  beforeAll(async () => {
    previousMaintenanceMode = process.env.BAKE_MALL_MAINTENANCE_MODE;
    previousWritersStopped = process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED;
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      source = new DataSource({
        type: 'mysql',
        host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
        port: resolveMysqlPort(),
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
      await source.initialize();
      await source.runMigrations();
      admin = await source.getRepository(AdminUser).save(
        source.getRepository(AdminUser).create({
          username: `current-printer-${randomUUID()}@example.com`,
          role: AdminRole.SUPER_ADMIN,
          loginPhone: null,
          linkedUserId: null,
          passwordHash: 'test-only',
          isActive: true,
          mustChangePassword: false,
          tokenVersion: 1,
          verifyFailedCount: 0,
          verifyWindowStartedAt: null,
          lastPasswordChangedAt: null,
        }),
      );
      printers = await Promise.all([
        savePrinter('SN-Current-Mysql-A'),
        savePrinter('SN-Current-Mysql-B'),
      ]);
      process.env.BAKE_MALL_MAINTENANCE_MODE = '1';
      process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED = '1';
    } catch (error) {
      try {
        if (source?.isInitialized) await source.destroy();
      } finally {
        cleanupDatabase?.();
        cleanupDatabase = undefined;
      }
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
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
      cleanupDatabase = undefined;
    }
    expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
      schemaCount: 0,
      grantCount: 0,
    });
  }, 60_000);

  it('0016 up 创建完整 singleton schema、两个 FK 与唯一 STORE 行', async () => {
    const database = requireDatabase();
    const columns = (await database.query(`SELECT COLUMN_NAME, COLUMN_TYPE,
      IS_NULLABLE, COLUMN_DEFAULT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cloud_printer_store_settings'
      ORDER BY ORDINAL_POSITION`)) as Array<Record<string, unknown>>;
    const constraints = (await database.query(`SELECT CONSTRAINT_NAME,
      REFERENCED_TABLE_NAME
      FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cloud_printer_store_settings'
      ORDER BY CONSTRAINT_NAME`)) as Array<Record<string, unknown>>;
    const settings = await database.getRepository(CloudPrinterStoreSetting).find();

    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          COLUMN_NAME: 'current_printer_id',
          COLUMN_TYPE: 'bigint unsigned',
          IS_NULLABLE: 'YES',
        }),
        expect.objectContaining({
          COLUMN_NAME: 'revision',
          COLUMN_TYPE: 'int unsigned',
          IS_NULLABLE: 'NO',
          COLUMN_DEFAULT: '1',
        }),
      ]),
    );
    expect(constraints).toEqual([
      {
        CONSTRAINT_NAME: 'fk_cloud_printer_store_settings_current_printer',
        REFERENCED_TABLE_NAME: 'cloud_printers',
      },
      {
        CONSTRAINT_NAME: 'fk_cloud_printer_store_settings_updated_by_admin',
        REFERENCED_TABLE_NAME: 'admin_users',
      },
    ]);
    expect(settings).toEqual([
      expect.objectContaining({
        scopeKey: CLOUD_PRINTER_STORE_SCOPE,
        currentPrinterId: null,
        revision: 1,
      }),
    ]);
    await expect(
      database.query(
        "INSERT INTO cloud_printer_store_settings (scope_key, revision) VALUES ('STORE', 1)",
      ),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    await expect(
      database.query(
        "UPDATE cloud_printer_store_settings SET current_printer_id = 18446744073709551615 WHERE scope_key = 'STORE'",
      ),
    ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
  });

  it('0016 down 在 current 非空时拒绝并保持表、FK 与 singleton 原样', async () => {
    const database = requireDatabase();
    await database.query(
      `UPDATE cloud_printer_store_settings
       SET current_printer_id = ?, revision = 2, updated_by_admin_id = ?
       WHERE scope_key = ?`,
      [printers[0].id, admin.id, CLOUD_PRINTER_STORE_SCOPE],
    );
    const before = await database.getRepository(CloudPrinterStoreSetting).find();
    const runner = database.createQueryRunner();
    await runner.connect();

    const migration = DATABASE_MIGRATIONS.at(-1);
    if (!migration) throw new Error('Current printer migration is missing');
    await expect(new migration().down(runner)).rejects.toThrow(
      /current|当前打印机/iu,
    );

    const after = await database.getRepository(CloudPrinterStoreSetting).find();
    const [{ tableCount }] = (await database.query(`SELECT COUNT(*) AS tableCount
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cloud_printer_store_settings'`)) as Array<{
      tableCount: number | string;
    }>;
    expect(after).toEqual(before);
    expect(Number(tableCount)).toBe(1);
    await runner.release();
    await resetCurrent(10);
  });

  it('两个独立并发 set 使用相同 expectedRevision 时恰一成功并保留单一 current', async () => {
    await resetCurrent(20);
    const connectionIds: number[] = [];
    const concurrentSource = dataSourceWithTransactionBarrier(
      requireDatabase(),
      connectionIds,
    );
    const serviceA = createService(concurrentSource);
    const serviceB = createService(concurrentSource);

    const outcomes = await Promise.allSettled([
      serviceA.set(
        { id: admin.id } as never,
        {
          printerId: printers[0].id,
          expectedRevision: 20,
          operationPassword: OPERATION_PASSWORD,
        },
        newKey(),
      ),
      serviceB.set(
        { id: admin.id } as never,
        {
          printerId: printers[1].id,
          expectedRevision: 20,
          operationPassword: OPERATION_PASSWORD,
        },
        newKey(),
      ),
    ]);

    expect(new Set(connectionIds).size).toBe(2);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      response: { code: ApiErrorCode.CLOUD_PRINTER_CURRENT_VERSION_CONFLICT },
    });
    const setting = await requireDatabase()
      .getRepository(CloudPrinterStoreSetting)
      .findOneByOrFail({ scopeKey: CLOUD_PRINTER_STORE_SCOPE });
    expect(setting.revision).toBe(21);
    expect([printers[0].id, printers[1].id]).toContain(
      setting.currentPrinterId,
    );
  });

  it('并发 set 与 clear 使用相同 expectedRevision 时也恰一成功', async () => {
    await requireDatabase().query(
      `UPDATE cloud_printer_store_settings
       SET current_printer_id = ?, revision = 30, updated_by_admin_id = ?
       WHERE scope_key = ?`,
      [printers[0].id, admin.id, CLOUD_PRINTER_STORE_SCOPE],
    );
    const connectionIds: number[] = [];
    const concurrentSource = dataSourceWithTransactionBarrier(
      requireDatabase(),
      connectionIds,
    );
    const setService = createService(concurrentSource);
    const clearService = createService(concurrentSource);

    const outcomes = await Promise.allSettled([
      setService.set(
        { id: admin.id } as never,
        {
          printerId: printers[1].id,
          expectedRevision: 30,
          operationPassword: OPERATION_PASSWORD,
        },
        newKey(),
      ),
      clearService.clear(
        { id: admin.id } as never,
        {
          expectedRevision: 30,
          operationPassword: OPERATION_PASSWORD,
        },
        newKey(),
      ),
    ]);

    expect(new Set(connectionIds).size).toBe(2);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    const setting = await requireDatabase()
      .getRepository(CloudPrinterStoreSetting)
      .findOneByOrFail({ scopeKey: CLOUD_PRINTER_STORE_SCOPE });
    expect(setting.revision).toBe(31);
    expect([null, printers[1].id]).toContain(setting.currentPrinterId);
  });
});
