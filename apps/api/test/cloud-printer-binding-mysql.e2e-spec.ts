import 'reflect-metadata';

import {
  AdminRole,
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  SUPER_ADMIN_PERMISSIONS,
  VendorRelationState,
  type BindCloudPrinterResult,
} from '@bake-mall/contracts';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AdminOperationIdempotency } from '../src/database/entities/admin-operation-idempotency.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import { CloudPrinter } from '../src/database/entities/cloud-printer.entity.js';
import * as entities from '../src/database/entities/index.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { CloudPrinterReconciliationService } from '../src/printing/cloud-printer-reconciliation.service.js';
import {
  CloudPrinterService,
  type XpyunVendorPort,
} from '../src/printing/cloud-printer.service.js';
import { createAdminOperationIdempotencyTestService } from './helpers/admin-operation-idempotency.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_cloud_printers_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };

let idempotencyKeySequence = 300;
const deterministicIdempotencyKey = (): string =>
  `00000000-0000-4000-8000-${String(++idempotencyKeySequence).padStart(12, '0')}`;

const hashChallengeFixture = (code: string): Promise<string> =>
  bcrypt.hash(code, 4);

const principal = (id: string) => ({
  id,
  username: 'cloud-printer-bind@example.com',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  mustChangePassword: false,
  permissions: SUPER_ADMIN_PERMISSIONS,
});

type TransactionProbe = Readonly<{
  connectionIds: number[];
  entered: Promise<void>;
  release: () => void;
  observe: (manager: EntityManager) => Promise<void>;
}>;

const createTransactionProbe = (
  expectedTransactions: number,
): TransactionProbe => {
  const connectionIds: number[] = [];
  let enteredCount = 0;
  let resolveEntered!: () => void;
  let resolveRelease!: () => void;
  const entered = new Promise<void>((resolve) => {
    resolveEntered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  return {
    connectionIds,
    entered,
    release: resolveRelease,
    async observe(manager: EntityManager) {
      if (enteredCount >= expectedTransactions) return;
      const rows = (await manager.query(
        'SELECT CONNECTION_ID() AS id',
      )) as Array<{
        id: number | string;
      }>;
      connectionIds.push(Number(rows[0]?.id));
      enteredCount += 1;
      if (enteredCount === expectedTransactions) resolveEntered();
      await released;
    },
  };
};

const transactionProbeDataSource = (
  source: DataSource,
  probe: TransactionProbe,
): DataSource =>
  new Proxy(source, {
    get(target, property, receiver) {
      if (property !== 'transaction')
        return Reflect.get(target, property, receiver);
      return async <T>(
        isolationOrRun:
          | Parameters<DataSource['transaction']>[0]
          | ((manager: EntityManager) => Promise<T>),
        maybeRun?: (manager: EntityManager) => Promise<T>,
      ): Promise<T> => {
        const run =
          typeof isolationOrRun === 'function' ? isolationOrRun : maybeRun;
        if (!run) throw new Error('transaction callback missing');
        const runner: QueryRunner = target.createQueryRunner();
        await runner.connect();
        await runner.startTransaction(
          typeof isolationOrRun === 'string' ? isolationOrRun : undefined,
        );
        try {
          await probe.observe(runner.manager);
          const result = await run(runner.manager);
          await runner.commitTransaction();
          return result;
        } catch (error) {
          await runner.rollbackTransaction();
          throw error;
        } finally {
          await runner.release();
        }
      };
    },
  });

describe.sequential('CloudPrinterService binding (real MySQL)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let dataSource: DataSource | undefined;
  let admin: AdminUser;
  let service: CloudPrinterService;
  const vendor = {
    addPrinter: vi.fn(async () => ({ vendorCode: '0', vendorMessage: 'ok' })),
    deletePrinter: vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    })),
    print: vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-1',
    })),
    queryOnline: vi.fn(async () => ({
      status: 'ONLINE' as const,
      vendorCode: '0',
    })),
  };

  const requireDatabase = (): DataSource => {
    if (!dataSource)
      throw new Error('Temporary MySQL data source is unavailable');
    return dataSource;
  };

  const verification = {
    verifyPassword: vi.fn(async () => ({
      status: 'VERIFIED' as const,
      admin: admin as never,
    })),
  };

  const createService = (
    vendorPort: XpyunVendorPort = vendor,
    auditService: AuditService = new AuditService(
      requireDatabase().getRepository(AuditLog),
    ),
    source: DataSource = requireDatabase(),
    now?: () => Date,
  ): CloudPrinterService =>
    new CloudPrinterService(
      source,
      verification as never,
      auditService,
      createAdminOperationIdempotencyTestService(
        source.getRepository(AdminOperationIdempotency),
      ),
      vendorPort,
      now,
      { verificationCodeBcryptCost: 4 },
    );

  const createReconciliationService = (
    vendorPort: XpyunVendorPort,
    now: () => Date,
  ): CloudPrinterReconciliationService =>
    new CloudPrinterReconciliationService(
      requireDatabase(),
      verification as never,
      new AuditService(requireDatabase().getRepository(AuditLog)),
      createAdminOperationIdempotencyTestService(
        requireDatabase().getRepository(AdminOperationIdempotency),
      ),
      vendorPort,
      now,
    );

  const insertResendPrinter = async (
    serialNumber: string,
    challenge: Readonly<{
      expiresAt: Date;
      failedAttempts: number;
      status: CloudPrinterStatus;
    }>,
  ): Promise<CloudPrinter> => {
    const repository = requireDatabase().getRepository(CloudPrinter);
    const printer = repository.create();
    Object.assign(printer, {
      serialNumber,
      displayName: '重发恢复设备',
      status: challenge.status,
      bindingStage:
        challenge.status === CloudPrinterStatus.ERROR
          ? PrinterBindingStage.PRINT_VERIFICATION_CODE
          : PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      bindingOperationId: null,
      verificationCodeHash: await hashChallengeFixture('111111'),
      verificationExpiresAt: challenge.expiresAt,
      verificationFailedAttempts: challenge.failedAttempts,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: admin.id,
      lastVendorErrorCode: null,
      unboundAt: null,
    } satisfies Partial<CloudPrinter>);
    return repository.save(printer);
  };

  const expectSuccessfulSameRecordResend = async (
    printerBefore: CloudPrinter,
    oldChallengeHash: string,
    key: string,
    vendorPort: XpyunVendorPort,
    expectedPrintCalls = 1,
  ): Promise<void> => {
    const repository = requireDatabase().getRepository(CloudPrinter);
    const result = await createService(vendorPort).resend(
      principal(admin.id) as never,
      printerBefore.id,
      { operationPassword: 'pw' },
      key,
    );

    expect(result.printer.id).toBe(printerBefore.id);
    expect(
      await repository.countBy({ serialNumber: printerBefore.serialNumber }),
    ).toBe(1);
    expect(vendorPort.addPrinter).not.toHaveBeenCalled();
    expect(vendorPort.deletePrinter).not.toHaveBeenCalled();
    expect(vendorPort.print).toHaveBeenCalledTimes(expectedPrintCalls);
    const stored = await repository.findOneByOrFail({ id: printerBefore.id });
    expect(stored).toMatchObject({
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: key,
      verificationFailedAttempts: 0,
    });
    expect(stored.verificationCodeHash).not.toBe(oldChallengeHash);
    expect(stored.verificationCodeHash).not.toBeNull();
    await expect(
      bcrypt.compare('111111', stored.verificationCodeHash!),
    ).resolves.toBe(false);
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneByOrFail({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_RESEND',
          key,
        }),
    ).toMatchObject({
      status: 'COMPLETED',
      resourceId: printerBefore.id,
    });
  };

  beforeAll(async () => {
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      dataSource = new DataSource({
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
      await dataSource.initialize();
      await dataSource.runMigrations();

      admin = await dataSource.getRepository(AdminUser).save(
        dataSource.getRepository(AdminUser).create({
          username: 'cloud-printer-bind@example.com',
          role: AdminRole.SUPER_ADMIN,
          linkedUserId: null,
          passwordHash: 'not-used',
          isActive: true,
          mustChangePassword: false,
          tokenVersion: 1,
          verifyFailedCount: 0,
          verifyWindowStartedAt: null,
          lastPasswordChangedAt: null,
        }),
      );

      service = createService();
    } catch (error) {
      try {
        if (dataSource?.isInitialized) await dataSource.destroy();
      } finally {
        cleanupDatabase?.();
        cleanupDatabase = undefined;
      }
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

  it('binds a new printer, generates a PENDING_VERIFICATION row, and clears SN/secret from the response', async () => {
    const key = deterministicIdempotencyKey();
    const result = await service.bind(
      principal(admin.id) as never,
      {
        serialNumber: 'SN-BindMysql-1',
        displayName: '前台',
        operationPassword: 'pw',
      },
      key,
    );
    const bindResult = result as BindCloudPrinterResult;
    expect(bindResult.printer.status).toBe('PENDING_VERIFICATION');
    expect(bindResult.printer.serialNumberMasked).toMatch(/^SN\*+-1$/u);
    const serialized = JSON.stringify(bindResult);
    expect(serialized).not.toContain('SN-BindMysql-1');
    expect(serialized).not.toContain('top-secret-key');
    expect(serialized).not.toContain('pw');

    const stored = await requireDatabase()
      .getRepository(CloudPrinter)
      .findOne({
        where: { id: bindResult.printer.id },
      });
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('PENDING_VERIFICATION');
    expect(stored?.verificationCodeHash).not.toBeNull();
    expect(stored?.verifiedAt).toBeNull();

    const record = await requireDatabase()
      .getRepository(AdminOperationIdempotency)
      .findOne({
        where: {
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_BIND',
          key,
        },
      });
    expect(record?.status).toBe('COMPLETED');
    expect(record?.resourceId).toBe(bindResult.printer.id);
    expect(stored?.bindingOperationId).toBe(record?.id);
    expect(stored?.bindingIdempotencyKey).toBe(key);
  });

  it('replays same Idempotency-Key without invoking vendor twice', async () => {
    const key = deterministicIdempotencyKey();
    const first = await service.bind(
      principal(admin.id) as never,
      {
        serialNumber: 'SN-BindMysql-Replay',
        displayName: '前台',
        operationPassword: 'pw',
      },
      key,
    );
    const beforeAdd = vendor.addPrinter.mock.calls.length;
    const beforePrint = vendor.print.mock.calls.length;

    const second = await service.bind(
      principal(admin.id) as never,
      {
        serialNumber: 'SN-BindMysql-Replay',
        displayName: '前台',
        operationPassword: 'pw',
      },
      key,
    );

    expect(vendor.addPrinter.mock.calls.length).toBe(beforeAdd);
    expect(vendor.print.mock.calls.length).toBe(beforePrint);
    expect(second.printer.id).toBe(first.printer.id);
  });

  it('same key with different serial is rejected as IDEMPOTENCY_CONFLICT', async () => {
    const key = deterministicIdempotencyKey();
    await service.bind(
      principal(admin.id) as never,
      {
        serialNumber: 'SN-BindMysql-Conflict',
        displayName: '前台',
        operationPassword: 'pw',
      },
      key,
    );

    await expect(
      service.bind(
        principal(admin.id) as never,
        {
          serialNumber: 'SN-BindMysql-Other',
          displayName: '前台',
          operationPassword: 'pw',
        },
        key,
      ),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.IDEMPOTENCY_CONFLICT },
    });
  });

  it('persists and replays ownership conflict as one stable FAILED operation without changing the printer', async () => {
    const repository = requireDatabase().getRepository(CloudPrinter);
    const existing = repository.create();
    Object.assign(existing, {
      serialNumber: 'SN-BindMysql-Ownership',
      displayName: '既有设备',
      status: CloudPrinterStatus.ACTIVE,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: 'existing-operation',
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      lastOnlineStatus: CloudPrinterOnlineStatus.ONLINE,
      lastStatusCheckedAt: new Date('2026-08-01T00:00:00.000Z'),
      boundByAdminId: admin.id,
      lastVendorErrorCode: null,
      unboundAt: null,
    } satisfies Partial<CloudPrinter>);
    await repository.save(existing);
    const key = deterministicIdempotencyKey();
    const request = {
      serialNumber: existing.serialNumber,
      displayName: '禁止覆盖',
      operationPassword: 'ownership-mysql-secret',
    };
    const beforeAdd = vendor.addPrinter.mock.calls.length;
    const beforePrint = vendor.print.mock.calls.length;

    await expect(
      service.bind(principal(admin.id) as never, request, key),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT },
    });
    await expect(
      service.bind(principal(admin.id) as never, request, key),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT },
    });

    expect(vendor.addPrinter.mock.calls.length).toBe(beforeAdd);
    expect(vendor.print.mock.calls.length).toBe(beforePrint);
    const storedPrinter = await requireDatabase()
      .getRepository(CloudPrinter)
      .findOneByOrFail({ id: existing.id });
    expect(storedPrinter).toMatchObject({
      displayName: '既有设备',
      status: 'ACTIVE',
      bindingStage: 'NONE',
      vendorRelationState: 'CONFIRMED_BOUND',
      bindingIdempotencyKey: 'existing-operation',
      verificationCodeHash: null,
    });
    const operation = await requireDatabase()
      .getRepository(AdminOperationIdempotency)
      .findOneByOrFail({
        adminId: admin.id,
        operation: 'CLOUD_PRINTER_BIND',
        key,
      });
    expect(operation).toMatchObject({
      status: 'FAILED',
      resourceType: 'CLOUD_PRINTER',
      resourceId: existing.id,
      responseSnapshot: {
        printerId: existing.id,
        code: 'OWNERSHIP_CONFLICT',
      },
    });
    const auditRows = await requireDatabase()
      .getRepository(AuditLog)
      .find({
        where: { targetEntity: 'cloud_printers', targetId: existing.id },
      });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'CLOUD_PRINTER_BIND_FAILED',
      changeSummary: expect.objectContaining({ result: 'FAILED' }),
    });
    const serialized = JSON.stringify({ operation, auditRows });
    expect(serialized).not.toContain(existing.serialNumber);
    expect(serialized).not.toContain('ownership-mysql-secret');
  });

  it('concurrent same key uses distinct connections, one vendor owner, and terminal replay', async () => {
    const serialNumber = 'SN-BindMysql-SameKey';
    const key = deterministicIdempotencyKey();
    const beforeAdd = vendor.addPrinter.mock.calls.length;
    const beforePrint = vendor.print.mock.calls.length;
    const request = {
      serialNumber,
      displayName: '同键并发设备',
      operationPassword: 'pw',
    };
    const probe = createTransactionProbe(2);
    const probedDataSource = transactionProbeDataSource(
      requireDatabase(),
      probe,
    );
    const probedService = createService(
      vendor,
      new AuditService(probedDataSource.getRepository(AuditLog)),
      probedDataSource,
    );

    const outcomesPromise = Promise.allSettled([
      probedService.bind(principal(admin.id) as never, request, key),
      probedService.bind(principal(admin.id) as never, request, key),
    ]);
    await probe.entered;
    expect(new Set(probe.connectionIds).size).toBe(2);
    console.info('same-key MySQL CONNECTION_IDs', probe.connectionIds);
    probe.release();
    const outcomes = await outcomesPromise;

    expect(
      outcomes.filter(({ status }) => status === 'fulfilled').length,
    ).toBeGreaterThanOrEqual(1);
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );
    for (const outcome of rejected) {
      expect(outcome.reason).toMatchObject({
        response: { code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS },
      });
    }
    expect(vendor.addPrinter.mock.calls.length).toBe(beforeAdd + 1);
    expect(vendor.print.mock.calls.length).toBe(beforePrint + 1);
    const operation = await requireDatabase()
      .getRepository(AdminOperationIdempotency)
      .findOneByOrFail({
        adminId: admin.id,
        operation: 'CLOUD_PRINTER_BIND',
        key,
      });
    expect(operation.status).toBe('COMPLETED');
    const replay = await probedService.bind(
      principal(admin.id) as never,
      request,
      key,
    );
    expect(replay.printer.id).toBe(operation.resourceId);
    expect(vendor.addPrinter.mock.calls.length).toBe(beforeAdd + 1);
    expect(vendor.print.mock.calls.length).toBe(beforePrint + 1);
  });

  it('concurrent different keys for the same serial produce one vendor owner, one row, and one stable loser', async () => {
    const serialNumber = 'SN-BindMysql-Concurrent';
    const keys = [deterministicIdempotencyKey(), deterministicIdempotencyKey()];
    const beforeAdd = vendor.addPrinter.mock.calls.length;
    const beforePrint = vendor.print.mock.calls.length;
    const request = {
      serialNumber,
      displayName: '并发设备',
      operationPassword: 'pw',
    };
    const probe = createTransactionProbe(2);
    const probedDataSource = transactionProbeDataSource(
      requireDatabase(),
      probe,
    );
    const probedService = new CloudPrinterService(
      probedDataSource,
      {
        verifyPassword: vi.fn(async () => ({
          status: 'VERIFIED' as const,
          admin: admin as never,
        })),
      } as never,
      new AuditService(probedDataSource.getRepository(AuditLog)),
      createAdminOperationIdempotencyTestService(
        probedDataSource.getRepository(AdminOperationIdempotency),
      ),
      vendor,
    );

    const outcomesPromise = Promise.allSettled(
      keys.map((key) =>
        probedService.bind(principal(admin.id) as never, request, key),
      ),
    );
    await probe.entered;
    expect(new Set(probe.connectionIds).size).toBe(2);
    console.info('same-SN MySQL CONNECTION_IDs', probe.connectionIds);
    probe.release();
    const outcomes = await outcomesPromise;

    expect(new Set(probe.connectionIds).size).toBe(2);
    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      response: { code: ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT },
    });
    expect(vendor.addPrinter.mock.calls.length).toBe(beforeAdd + 1);
    expect(vendor.print.mock.calls.length).toBe(beforePrint + 1);
    expect(
      await requireDatabase().getRepository(CloudPrinter).countBy({
        serialNumber,
      }),
    ).toBe(1);
    const operations = await requireDatabase()
      .getRepository(AdminOperationIdempotency)
      .find({
        where: keys.map((key) => ({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_BIND',
          key,
        })),
      });
    expect(operations).toHaveLength(2);
    expect(operations.map(({ status }) => status).sort()).toEqual([
      'COMPLETED',
      'FAILED',
    ]);
    const failed = operations.find(({ status }) => status === 'FAILED');
    expect(failed?.responseSnapshot).toMatchObject({
      code: 'OWNERSHIP_CONFLICT',
    });
  });

  it('vendor rejection atomically persists FAILED printer/idempotency/audit classification', async () => {
    const transientVendor = {
      addPrinter: vi.fn(async () => {
        throw Object.assign(new Error('rejected'), {
          name: 'XpyunAdapterError',
          classification: 'FAILED',
          vendorCode: '1003',
        });
      }),
      deletePrinter: vi.fn(async () => ({
        vendorCode: '0',
        vendorMessage: 'ok',
      })),
      print: vendor.print,
      queryOnline: vendor.queryOnline,
    };
    const transientService = new CloudPrinterService(
      requireDatabase(),
      {
        verifyPassword: vi.fn(async () => ({
          status: 'VERIFIED' as const,
          admin: admin as never,
        })),
      } as never,
      new AuditService(requireDatabase().getRepository(AuditLog)),
      createAdminOperationIdempotencyTestService(
        requireDatabase().getRepository(AdminOperationIdempotency),
      ),
      transientVendor,
    );

    const idempotencyKey = deterministicIdempotencyKey();
    await expect(
      transientService.bind(
        principal(admin.id) as never,
        {
          serialNumber: 'SN-BindMysql-Reject',
          displayName: '前台',
          operationPassword: 'pw',
        },
        idempotencyKey,
      ),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED },
    });

    const storedPrinter = await requireDatabase()
      .getRepository(CloudPrinter)
      .findOneByOrFail({ serialNumber: 'SN-BindMysql-Reject' });
    expect(storedPrinter).toMatchObject({
      status: 'UNBOUND',
      bindingStage: 'NONE',
      vendorRelationState: 'CONFIRMED_UNBOUND',
      verificationCodeHash: null,
      verificationExpiresAt: null,
      lastVendorErrorCode: '1003',
    });
    expect(storedPrinter.unboundAt).toBeInstanceOf(Date);

    const operation = await requireDatabase()
      .getRepository(AdminOperationIdempotency)
      .findOneByOrFail({
        adminId: admin.id,
        operation: 'CLOUD_PRINTER_BIND',
        key: idempotencyKey,
      });
    expect(operation).toMatchObject({
      status: 'FAILED',
      resourceType: 'CLOUD_PRINTER',
      resourceId: storedPrinter.id,
      responseSnapshot: {
        printerId: storedPrinter.id,
        code: 'VENDOR_REJECTED',
      },
    });
    const auditRows = await requireDatabase()
      .getRepository(AuditLog)
      .find({
        where: {
          targetEntity: 'cloud_printers',
          targetId: storedPrinter.id,
          action: 'CLOUD_PRINTER_BIND_FAILED',
        },
      });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.changeSummary).toMatchObject({
      result: 'FAILED',
      status: 'UNBOUND',
      vendorCode: '1003',
    });
    const serialized = JSON.stringify({ operation, auditRows });
    expect(serialized).not.toContain('SN-BindMysql-Reject');
    expect(serialized).not.toContain('pw');
  });

  it('concurrent confirm overlaps on two MySQL connections and permits one ACTIVE transition', async () => {
    const bind = await service.bind(
      principal(admin.id) as never,
      {
        serialNumber: 'SN-BindMysql-Confirm-Probed',
        displayName: '确认连接证据',
        operationPassword: 'pw',
      },
      deterministicIdempotencyKey(),
    );
    const repository = requireDatabase().getRepository(CloudPrinter);
    const printer = await repository.findOneByOrFail({ id: bind.printer.id });
    printer.verificationCodeHash = await hashChallengeFixture('654321');
    await repository.save(printer);
    const probe = createTransactionProbe(2);
    const probedSource = transactionProbeDataSource(requireDatabase(), probe);
    const probedService = createService(
      vendor,
      new AuditService(probedSource.getRepository(AuditLog)),
      probedSource,
    );
    const confirmKeys = [
      deterministicIdempotencyKey(),
      deterministicIdempotencyKey(),
    ];
    const request = {
      challengeId: printer.id,
      code: '654321',
      operationPassword: 'pw',
    };

    const outcomesPromise = Promise.allSettled(
      confirmKeys.map((key) =>
        probedService.confirm(principal(admin.id) as never, request, key),
      ),
    );
    await probe.entered;
    expect(new Set(probe.connectionIds).size).toBe(2);
    console.info('confirm MySQL CONNECTION_IDs', probe.connectionIds);
    probe.release();
    const outcomes = await outcomesPromise;

    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(await repository.findOneByOrFail({ id: printer.id })).toMatchObject({
      status: CloudPrinterStatus.ACTIVE,
      verificationCodeHash: null,
      verificationFailedAttempts: 0,
    });
    expect(
      await requireDatabase()
        .getRepository(AuditLog)
        .count({
          where: {
            targetEntity: 'cloud_printers',
            targetId: printer.id,
            action: 'CLOUD_PRINTER_CONFIRMED',
          },
        }),
    ).toBe(1);
    const operations = await requireDatabase()
      .getRepository(AdminOperationIdempotency)
      .find({
        where: confirmKeys.map((key) => ({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_CONFIRM',
          key,
        })),
      });
    expect(operations).toHaveLength(2);
    expect(operations.map(({ status }) => status).sort()).toEqual([
      'COMPLETED',
      'FAILED',
    ]);
  });

  it('concurrent invalid confirms overlap on two MySQL connections and never increment beyond five attempts', async () => {
    const bind = await service.bind(
      principal(admin.id) as never,
      {
        serialNumber: 'SN-BindMysql-Confirm-Limit',
        displayName: '错误次数并发',
        operationPassword: 'pw',
      },
      deterministicIdempotencyKey(),
    );
    const repository = requireDatabase().getRepository(CloudPrinter);
    const printer = await repository.findOneByOrFail({ id: bind.printer.id });
    printer.verificationCodeHash = await hashChallengeFixture('999999');
    printer.verificationFailedAttempts = 4;
    await repository.save(printer);
    const probe = createTransactionProbe(2);
    const probedSource = transactionProbeDataSource(requireDatabase(), probe);
    const probedService = createService(
      vendor,
      new AuditService(probedSource.getRepository(AuditLog)),
      probedSource,
    );
    const request = {
      challengeId: printer.id,
      code: '111111',
      operationPassword: 'pw',
    };

    const confirmKeys = [
      deterministicIdempotencyKey(),
      deterministicIdempotencyKey(),
    ];
    const outcomesPromise = Promise.allSettled(
      confirmKeys.map((key) =>
        probedService.confirm(principal(admin.id) as never, request, key),
      ),
    );
    await probe.entered;
    expect(new Set(probe.connectionIds).size).toBe(2);
    console.info('attempt-limit MySQL CONNECTION_IDs', probe.connectionIds);
    probe.release();
    const outcomes = await outcomesPromise;

    expect(outcomes.every(({ status }) => status === 'rejected')).toBe(true);
    const responseCodes = outcomes.map((outcome) => {
      expect(outcome.status).toBe('rejected');
      return (outcome as PromiseRejectedResult).reason.response.code as string;
    });
    expect(responseCodes).toContain(
      ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED,
    );
    expect(
      responseCodes.every(
        (code) =>
          code === ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED ||
          code === ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
      ),
    ).toBe(true);

    const stored = await repository.findOneByOrFail({ id: printer.id });
    expect(stored.verificationFailedAttempts).toBe(5);
    expect(stored.status).toBe(CloudPrinterStatus.ERROR);

    const operations = await requireDatabase()
      .getRepository(AdminOperationIdempotency)
      .find({
        where: confirmKeys.map((key) => ({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_CONFIRM',
          key,
        })),
      });
    expect(operations).toHaveLength(2);
    for (const [index, key] of confirmKeys.entries()) {
      const operation = operations.find((candidate) => candidate.key === key);
      const responseCode = responseCodes[index];
      expect(operation).toMatchObject({
        status: 'FAILED',
        resourceType: 'CLOUD_PRINTER',
        resourceId: printer.id,
      });
      expect(operation?.status).not.toBe('IN_PROGRESS');
      expect(['ATTEMPTS_EXHAUSTED', 'INVALID_STATE']).toContain(
        operation?.responseSnapshot?.code,
      );
      expect(responseCode).toBe(
        operation?.responseSnapshot?.code === 'ATTEMPTS_EXHAUSTED'
          ? ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED
          : ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
      );
    }
    expect(
      operations.some(
        ({ responseSnapshot }) =>
          responseSnapshot?.code === 'ATTEMPTS_EXHAUSTED',
      ),
    ).toBe(true);

    for (const [index, key] of confirmKeys.entries()) {
      await expect(
        probedService.confirm(principal(admin.id) as never, request, key),
      ).rejects.toMatchObject({ response: { code: responseCodes[index] } });
      expect(
        (await repository.findOneByOrFail({ id: printer.id }))
          .verificationFailedAttempts,
      ).toBe(5);
    }
  });

  it('treats DB UTC expiry equality as expired while allowing a confirm one second before expiry', async () => {
    const baseNowRows = (await requireDatabase().query(
      'SELECT UTC_TIMESTAMP() AS now',
    )) as Array<{ now: Date | string }>;
    const dbNow = new Date(baseNowRows[0]!.now);
    const boundaryBind = await service.bind(
      principal(admin.id) as never,
      {
        serialNumber: 'SN-BindMysql-Expiry-Boundary',
        displayName: '边界过期',
        operationPassword: 'pw',
      },
      deterministicIdempotencyKey(),
    );
    const beforeBind = await service.bind(
      principal(admin.id) as never,
      {
        serialNumber: 'SN-BindMysql-Expiry-Before',
        displayName: '边界前',
        operationPassword: 'pw',
      },
      deterministicIdempotencyKey(),
    );
    const repository = requireDatabase().getRepository(CloudPrinter);
    const boundary = await repository.findOneByOrFail({
      id: boundaryBind.printer.id,
    });
    Object.assign(boundary, {
      verificationCodeHash: await hashChallengeFixture('222222'),
      verificationExpiresAt: dbNow,
    } satisfies Partial<CloudPrinter>);
    await repository.save(boundary);
    const before = await repository.findOneByOrFail({
      id: beforeBind.printer.id,
    });
    Object.assign(before, {
      verificationCodeHash: await hashChallengeFixture('333333'),
      verificationExpiresAt: new Date(dbNow.getTime() + 1_000),
    } satisfies Partial<CloudPrinter>);
    await repository.save(before);
    const fixedClockService = createService(
      vendor,
      new AuditService(requireDatabase().getRepository(AuditLog)),
      requireDatabase(),
      () => dbNow,
    );

    await expect(
      fixedClockService.confirm(
        principal(admin.id) as never,
        {
          challengeId: boundary.id,
          code: '222222',
          operationPassword: 'pw',
        },
        deterministicIdempotencyKey(),
      ),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_EXPIRED },
    });
    await expect(
      fixedClockService.confirm(
        principal(admin.id) as never,
        {
          challengeId: before.id,
          code: '333333',
          operationPassword: 'pw',
        },
        deterministicIdempotencyKey(),
      ),
    ).resolves.toMatchObject({
      printer: { status: CloudPrinterStatus.ACTIVE },
    });
  });

  it.each([
    ['ACCEPTED', CloudPrinterStatus.UNBOUND, 'FAILED', 'CONFIRMED_UNBOUND'],
    ['FAILED', CloudPrinterStatus.ERROR, 'FAILED', 'CONFIRMED_BOUND'],
    ['UNKNOWN', CloudPrinterStatus.ERROR, 'UNKNOWN', 'UNKNOWN'],
  ] as const)(
    'persists print FAILED plus delete %s across printer, operation, and audit',
    async (deleteOutcome, expectedStatus, operationStatus, relation) => {
      const serialNumber = `SN-BindMysql-Delete-${deleteOutcome}`;
      const key = deterministicIdempotencyKey();
      const deletePrinter = vi.fn(async () => {
        if (deleteOutcome === 'ACCEPTED') {
          return { vendorCode: '0', vendorMessage: 'ok' };
        }
        throw Object.assign(new Error('delete outcome'), {
          name: 'XpyunAdapterError',
          classification: deleteOutcome,
          vendorCode: deleteOutcome === 'FAILED' ? '3001' : undefined,
        });
      });
      const localVendor = {
        ...vendor,
        addPrinter: vi.fn(async () => ({
          vendorCode: '0',
          vendorMessage: 'ok',
        })),
        print: vi.fn(async () => ({
          classification: 'FAILED' as const,
          vendorCode: '2001',
          vendorJobId: null,
        })),
        deletePrinter,
      };
      const localService = createService(localVendor);

      await expect(
        localService.bind(
          principal(admin.id) as never,
          { serialNumber, displayName: deleteOutcome, operationPassword: 'pw' },
          key,
        ),
      ).rejects.toBeDefined();

      expect(localVendor.addPrinter).toHaveBeenCalledTimes(1);
      expect(localVendor.print).toHaveBeenCalledTimes(1);
      expect(deletePrinter).toHaveBeenCalledTimes(1);
      const stored = await requireDatabase()
        .getRepository(CloudPrinter)
        .findOneByOrFail({ serialNumber });
      expect(stored).toMatchObject({
        status: expectedStatus,
        vendorRelationState: relation,
        verificationCodeHash: null,
      });
      const operation = await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneByOrFail({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_BIND',
          key,
        });
      expect(operation.status).toBe(operationStatus);
      expect(
        await requireDatabase()
          .getRepository(AuditLog)
          .count({
            where: {
              targetEntity: 'cloud_printers',
              targetId: stored.id,
              action: 'CLOUD_PRINTER_BIND_FAILED',
            },
          }),
      ).toBe(1);
    },
  );

  it('persists print UNKNOWN without issuing delete', async () => {
    const serialNumber = 'SN-BindMysql-Print-Unknown';
    const key = deterministicIdempotencyKey();
    const deletePrinter = vi.fn();
    const localVendor = {
      ...vendor,
      addPrinter: vi.fn(async () => ({
        vendorCode: '0',
        vendorMessage: 'ok',
      })),
      print: vi.fn(async () => ({
        classification: 'UNKNOWN' as const,
        vendorCode: 'timeout',
        vendorJobId: null,
      })),
      deletePrinter,
    };
    const localService = createService(localVendor);

    await expect(
      localService.bind(
        principal(admin.id) as never,
        { serialNumber, displayName: '未知打印', operationPassword: 'pw' },
        key,
      ),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN },
    });

    expect(deletePrinter).not.toHaveBeenCalled();
    const stored = await requireDatabase()
      .getRepository(CloudPrinter)
      .findOneByOrFail({ serialNumber });
    expect(stored).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      verificationCodeHash: null,
    });
    const operation = await requireDatabase()
      .getRepository(AdminOperationIdempotency)
      .findOneByOrFail({
        adminId: admin.id,
        operation: 'CLOUD_PRINTER_BIND',
        key,
      });
    expect(operation.status).toBe('UNKNOWN');
  });

  it('clears a resend challenge after explicit FAILED and permits a later resend on the same MySQL row', async () => {
    const printer = await insertResendPrinter('SN-BindMysql-Resend-Failed', {
      expiresAt: new Date('2026-08-04T00:05:00.000Z'),
      failedAttempts: 2,
      status: CloudPrinterStatus.PENDING_VERIFICATION,
    });
    const oldHash = printer.verificationCodeHash!;
    const callTrace: string[] = [];
    let printAttempt = 0;
    const print = vi.fn(async () => {
      callTrace.push('vendor:print');
      printAttempt += 1;
      return printAttempt === 1
        ? {
            classification: 'FAILED' as const,
            vendorCode: '2001',
            vendorJobId: null,
          }
        : {
            classification: 'ACCEPTED' as const,
            vendorCode: '0',
            vendorJobId: 'job-resend-failed-recovery',
          };
    });
    const localVendor = {
      ...vendor,
      addPrinter: vi.fn(vendor.addPrinter),
      deletePrinter: vi.fn(vendor.deletePrinter),
      print,
      queryOnline: vi.fn(vendor.queryOnline),
    } satisfies XpyunVendorPort;
    const failedKey = deterministicIdempotencyKey();

    await expect(
      createService(localVendor).resend(
        principal(admin.id) as never,
        printer.id,
        { operationPassword: 'pw' },
        failedKey,
      ),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED },
    });

    const repository = requireDatabase().getRepository(CloudPrinter);
    const afterFailure = await repository.findOneByOrFail({ id: printer.id });
    expect(afterFailure).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
    });
    expect(localVendor.addPrinter).not.toHaveBeenCalled();
    expect(localVendor.deletePrinter).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledTimes(1);
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneByOrFail({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_RESEND',
          key: failedKey,
        }),
    ).toMatchObject({ status: 'FAILED', resourceId: printer.id });

    await expectSuccessfulSameRecordResend(
      afterFailure,
      oldHash,
      deterministicIdempotencyKey(),
      localVendor,
      2,
    );
    expect(callTrace).toEqual(['vendor:print', 'vendor:print']);
  });

  it('reconciles UNKNOWN resend without restoring an unproven challenge before a later same-row resend', async () => {
    const recoveryNow = new Date('2026-08-04T00:10:00.000Z');
    const printer = await insertResendPrinter('SN-BindMysql-Resend-Unknown', {
      expiresAt: new Date(recoveryNow.getTime() + 60_000),
      failedAttempts: 1,
      status: CloudPrinterStatus.PENDING_VERIFICATION,
    });
    const oldHash = printer.verificationCodeHash!;
    const callTrace: string[] = [];
    let printAttempt = 0;
    const print = vi.fn(async () => {
      callTrace.push('vendor:print');
      printAttempt += 1;
      return printAttempt === 1
        ? {
            classification: 'UNKNOWN' as const,
            vendorCode: 'timeout',
            vendorJobId: null,
          }
        : {
            classification: 'ACCEPTED' as const,
            vendorCode: '0',
            vendorJobId: 'job-resend-unknown-recovery',
          };
    });
    const queryOnline = vi.fn(async () => {
      callTrace.push('vendor:queryOnline');
      return {
        status: 'ONLINE' as const,
        vendorCode: '0',
      };
    });
    const localVendor = {
      ...vendor,
      addPrinter: vi.fn(vendor.addPrinter),
      deletePrinter: vi.fn(vendor.deletePrinter),
      print,
      queryOnline,
    } satisfies XpyunVendorPort;
    const unknownKey = deterministicIdempotencyKey();

    await expect(
      createService(
        localVendor,
        undefined,
        undefined,
        () => recoveryNow,
      ).resend(
        principal(admin.id) as never,
        printer.id,
        { operationPassword: 'pw' },
        unknownKey,
      ),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN },
    });

    const repository = requireDatabase().getRepository(CloudPrinter);
    const afterUnknown = await repository.findOneByOrFail({ id: printer.id });
    expect(afterUnknown).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
    });
    expect(print).toHaveBeenCalledTimes(1);
    expect(queryOnline).not.toHaveBeenCalled();
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneByOrFail({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_RESEND',
          key: unknownKey,
        }),
    ).toMatchObject({ status: 'UNKNOWN', resourceId: printer.id });

    await createReconciliationService(localVendor, () => recoveryNow).requery(
      principal(admin.id),
      printer.id,
      { operationPassword: 'pw' },
      deterministicIdempotencyKey(),
    );

    const afterReconciliation = await repository.findOneByOrFail({
      id: printer.id,
    });
    expect(afterReconciliation).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
    });
    expect(queryOnline).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneByOrFail({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_RESEND',
          key: unknownKey,
        }),
    ).toMatchObject({
      status: 'FAILED',
      responseSnapshot: {
        printerId: printer.id,
        code: 'RECOVERY_REQUIRED',
      },
    });

    await expectSuccessfulSameRecordResend(
      afterReconciliation,
      oldHash,
      deterministicIdempotencyKey(),
      localVendor,
      2,
    );
    expect(callTrace).toEqual([
      'vendor:print',
      'vendor:queryOnline',
      'vendor:print',
    ]);
  });

  it.each([
    {
      caseName: 'expired',
      serialNumber: 'SN-BindMysql-Resend-Expired',
      expiresAt: new Date('2026-08-04T00:00:00.000Z'),
      failedAttempts: 0,
      status: CloudPrinterStatus.PENDING_VERIFICATION,
    },
    {
      caseName: 'exhausted',
      serialNumber: 'SN-BindMysql-Resend-Exhausted',
      expiresAt: new Date('2026-08-04T00:20:00.000Z'),
      failedAttempts: 5,
      status: CloudPrinterStatus.ERROR,
    },
  ])(
    'replaces an $caseName challenge on the same MySQL row without add/delete',
    async ({ serialNumber, expiresAt, failedAttempts, status }) => {
      const printer = await insertResendPrinter(serialNumber, {
        expiresAt,
        failedAttempts,
        status,
      });
      const oldHash = printer.verificationCodeHash!;
      const callTrace: string[] = [];
      const localVendor = {
        ...vendor,
        addPrinter: vi.fn(vendor.addPrinter),
        deletePrinter: vi.fn(vendor.deletePrinter),
        print: vi.fn(async () => {
          callTrace.push('vendor:print');
          return {
            classification: 'ACCEPTED' as const,
            vendorCode: '0',
            vendorJobId: `job-${serialNumber}`,
          };
        }),
        queryOnline: vi.fn(vendor.queryOnline),
      } satisfies XpyunVendorPort;

      await expectSuccessfulSameRecordResend(
        printer,
        oldHash,
        deterministicIdempotencyKey(),
        localVendor,
      );
      expect(callTrace).toEqual(['vendor:print']);
    },
  );

  it('resends on the same MySQL row without add/delete and invalidates the old challenge', async () => {
    const repository = requireDatabase().getRepository(CloudPrinter);
    const printer = repository.create();
    Object.assign(printer, {
      serialNumber: 'SN-BindMysql-Resend-Same-Row',
      displayName: '重发设备',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: 'old-key',
      verificationCodeHash: await hashChallengeFixture('111111'),
      verificationExpiresAt: new Date('2026-08-04T00:05:00.000Z'),
      verificationFailedAttempts: 3,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: admin.id,
      lastVendorErrorCode: null,
      unboundAt: null,
    } satisfies Partial<CloudPrinter>);
    const storedBefore = await repository.save(printer);
    const oldHash = storedBefore.verificationCodeHash;
    const beforeAdd = vendor.addPrinter.mock.calls.length;
    const beforeDelete = vendor.deletePrinter.mock.calls.length;
    const key = deterministicIdempotencyKey();

    const result = await service.resend(
      principal(admin.id) as never,
      storedBefore.id,
      { operationPassword: 'pw' },
      key,
    );

    expect(result.printer.id).toBe(storedBefore.id);
    expect(
      await repository.countBy({ serialNumber: storedBefore.serialNumber }),
    ).toBe(1);
    expect(vendor.addPrinter).toHaveBeenCalledTimes(beforeAdd);
    expect(vendor.deletePrinter).toHaveBeenCalledTimes(beforeDelete);
    const storedAfter = await repository.findOneByOrFail({
      id: storedBefore.id,
    });
    expect(storedAfter.verificationCodeHash).not.toBe(oldHash);
    expect(storedAfter.verificationFailedAttempts).toBe(0);
    expect(storedAfter.bindingIdempotencyKey).toBe(key);
    expect(storedAfter.bindingOperationId).not.toBeNull();
    await expect(
      bcrypt.compare('111111', storedAfter.verificationCodeHash!),
    ).resolves.toBe(false);
  });

  it('rebinds the same UNBOUND row, preserves ownership proof, and clears stale cycle state', async () => {
    const repository = requireDatabase().getRepository(CloudPrinter);
    const historicalVerifiedAt = new Date('2026-08-01T00:00:00.000Z');
    const existing = repository.create();
    Object.assign(existing, {
      serialNumber: 'SN-BindMysql-Rebind',
      displayName: '旧名',
      status: CloudPrinterStatus.UNBOUND,
      bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
      vendorRelationState: VendorRelationState.CONFIRMED_UNBOUND,
      bindingIdempotencyKey: 'old-key',
      verificationCodeHash: await hashChallengeFixture('111111'),
      verificationExpiresAt: new Date('2026-08-01T00:05:00.000Z'),
      verificationFailedAttempts: 4,
      verifiedAt: historicalVerifiedAt,
      lastOnlineStatus: CloudPrinterOnlineStatus.ONLINE,
      lastStatusCheckedAt: new Date('2026-08-01T00:00:00.000Z'),
      boundByAdminId: admin.id,
      lastVendorErrorCode: 'old-error',
      unboundAt: new Date('2026-08-01T00:00:00.000Z'),
    } satisfies Partial<CloudPrinter>);
    await repository.save(existing);
    const key = deterministicIdempotencyKey();

    const result = await service.bind(
      principal(admin.id) as never,
      {
        serialNumber: existing.serialNumber,
        displayName: '新名',
        operationPassword: 'pw',
      },
      key,
    );

    expect(result.printer.id).toBe(existing.id);
    expect(
      await repository.countBy({ serialNumber: existing.serialNumber }),
    ).toBe(1);
    const stored = await repository.findOneByOrFail({ id: existing.id });
    expect(stored).toMatchObject({
      displayName: '新名',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: key,
      verificationFailedAttempts: 0,
      verifiedAt: historicalVerifiedAt,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: admin.id,
      lastVendorErrorCode: null,
      unboundAt: null,
    });
    expect(stored.verificationCodeHash).not.toBeNull();
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneByOrFail({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_BIND',
          key,
        }),
    ).toMatchObject({ status: 'COMPLETED', resourceId: existing.id });
    expect(
      await requireDatabase()
        .getRepository(AuditLog)
        .count({
          where: {
            targetEntity: 'cloud_printers',
            targetId: existing.id,
            action: 'CLOUD_PRINTER_BIND_INITIATED',
          },
        }),
    ).toBe(1);
  });

  it('rolls back audit and business classification together, then releases the lock for retry', async () => {
    const serialNumber = 'SN-BindMysql-Audit-Rollback';
    const key = deterministicIdempotencyKey();
    let failAudit = true;
    const throwingAudit = {
      record: vi.fn(async (...args: unknown[]) => {
        if (failAudit) throw new Error('audit write rejected');
        return new AuditService(
          requireDatabase().getRepository(AuditLog),
        ).record(...(args as Parameters<AuditService['record']>));
      }),
    } as never;
    const localVendor = {
      ...vendor,
      addPrinter: vi.fn(async () => {
        throw Object.assign(new Error('vendor rejected'), {
          name: 'XpyunAdapterError',
          classification: 'FAILED',
          vendorCode: '1003',
        });
      }),
    };
    const localService = createService(localVendor, throwingAudit);
    const auditsBefore = await requireDatabase()
      .getRepository(AuditLog)
      .count({ where: { targetEntity: 'cloud_printers' } });

    await expect(
      localService.bind(
        principal(admin.id) as never,
        { serialNumber, displayName: '审计回滚', operationPassword: 'pw' },
        key,
      ),
    ).rejects.toThrow('audit write rejected');

    expect(
      await requireDatabase()
        .getRepository(CloudPrinter)
        .countBy({ serialNumber }),
    ).toBe(0);
    expect(
      await requireDatabase()
        .getRepository(AuditLog)
        .count({ where: { targetEntity: 'cloud_printers' } }),
    ).toBe(auditsBefore);
    expect(
      await requireDatabase().getRepository(AdminOperationIdempotency).countBy({
        adminId: admin.id,
        operation: 'CLOUD_PRINTER_BIND',
        key,
      }),
    ).toBe(0);
    expect(localVendor.addPrinter).not.toHaveBeenCalled();

    failAudit = false;
    await expect(
      localService.bind(
        principal(admin.id) as never,
        { serialNumber, displayName: '审计回滚', operationPassword: 'pw' },
        key,
      ),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED },
    });
    expect(localVendor.addPrinter).toHaveBeenCalledTimes(1);
    const retried = await requireDatabase()
      .getRepository(CloudPrinter)
      .findOneByOrFail({ serialNumber });
    expect(retried.status).toBe(CloudPrinterStatus.UNBOUND);
    expect(
      await requireDatabase()
        .getRepository(AuditLog)
        .count({
          where: { targetEntity: 'cloud_printers', targetId: retried.id },
        }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('cleanup removes the test schema after the run', async () => {
    expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
      schemaCount: 1,
      grantCount: 1,
    });
  });
});

void AuditService;
