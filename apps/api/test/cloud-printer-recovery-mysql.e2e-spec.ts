import 'reflect-metadata';

import {
  AdminRole,
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  SUPER_ADMIN_PERMISSIONS,
  VendorRelationState,
} from '@bake-mall/contracts';
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
import type { XpyunVendorPort } from '../src/printing/cloud-printer.service.js';
import { createAdminOperationIdempotencyTestService } from './helpers/admin-operation-idempotency.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_cloud_recovery_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const PASSWORD = 'recovery-password';
let keySequence = 900;
const newKey = (): string =>
  `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

const principal = (id: string) => ({
  id,
  username: 'cloud-printer-recovery@example.com',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  mustChangePassword: false,
  permissions: SUPER_ADMIN_PERMISSIONS,
});

const vendorError = (
  classification: 'FAILED' | 'UNKNOWN',
  vendorCode?: string,
) =>
  Object.assign(new Error('vendor error'), {
    name: 'XpyunAdapterError',
    classification,
    vendorCode,
  });

describe.sequential('Cloud printer recovery (real MySQL)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let dataSource: DataSource | undefined;
  let admin: AdminUser;
  const now = new Date('2026-08-09T00:00:30.000Z');

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

  const createVendor = (
    overrides: Partial<XpyunVendorPort> = {},
  ): XpyunVendorPort => ({
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
    ...overrides,
  });

  const createService = (
    vendor: XpyunVendorPort,
    auditService: AuditService = new AuditService(
      requireDatabase().getRepository(AuditLog),
    ),
    source: DataSource = requireDatabase(),
  ): CloudPrinterReconciliationService =>
    new CloudPrinterReconciliationService(
      source,
      verification as never,
      auditService,
      createAdminOperationIdempotencyTestService(
        source.getRepository(AdminOperationIdempotency),
      ),
      vendor,
      () => now,
    );

  const sourceWithAdvisoryConnectionProbe = (
    connectionIds: number[],
    onLockAttempt?: () => void,
  ): DataSource =>
    new Proxy(requireDatabase(), {
      get(target, property, receiver) {
        if (property !== 'createQueryRunner') {
          return Reflect.get(target, property, receiver);
        }
        return (): QueryRunner => {
          const runner = target.createQueryRunner();
          const query = runner.query.bind(runner);
          runner.query = async (...args: Parameters<QueryRunner['query']>) => {
            if (String(args[0]).includes('GET_LOCK')) {
              const rows = (await query(
                'SELECT CONNECTION_ID() AS id',
              )) as Array<{ id: number | string }>;
              connectionIds.push(Number(rows[0]?.id));
            }
            const result = await query(...args);
            if (String(args[0]).includes('GET_LOCK')) onLockAttempt?.();
            return result;
          };
          return runner;
        };
      },
    });

  const failingAuditService = (): AuditService =>
    ({
      record: async (_entry: unknown, manager: EntityManager) => {
        await manager.query(
          "INSERT INTO audit_logs (actor_type, admin_user_id, user_id, target_entity, target_id, action, change_summary) VALUES ('ADMIN', 18446744073709551615, NULL, 'cloud_printers', 'rollback', 'ROLLBACK_PROBE', NULL)",
        );
        throw new Error('expected audit FK failure');
      },
    }) as never;

  const insertPrinter = async (
    serialNumber: string,
    overrides: Partial<CloudPrinter> = {},
  ): Promise<CloudPrinter> => {
    const repository = requireDatabase().getRepository(CloudPrinter);
    const printer = repository.create();
    Object.assign(printer, {
      serialNumber,
      displayName: '恢复设备',
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.UNKNOWN,
      bindingIdempotencyKey: null,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: admin.id,
      lastVendorErrorCode: null,
      unboundAt: null,
      ...overrides,
    } satisfies Partial<CloudPrinter>);
    return repository.save(printer);
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
          username: 'cloud-printer-recovery@example.com',
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

  it('uses independent MySQL advisory-lock connections so overlapping administrator and scheduler recovery has one vendor owner', async () => {
    const printer = await insertPrinter('SN-Recovery-Concurrent', {
      updatedAt: new Date(now.getTime() - 60_000),
    });
    const key = newKey();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const vendorEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const connectionIds: number[] = [];
    let secondLockAttempted!: () => void;
    const secondLockAttempt = new Promise<void>((resolve) => {
      secondLockAttempted = resolve;
    });
    let lockAttempts = 0;
    let vendorCalls = 0;
    const vendor = createVendor({
      queryOnline: vi.fn(async () => {
        vendorCalls += 1;
        if (vendorCalls === 1) {
          entered();
          await barrier;
        }
        return { status: 'OFFLINE' as const, vendorCode: '0' };
      }),
    });
    const source = sourceWithAdvisoryConnectionProbe(connectionIds, () => {
      lockAttempts += 1;
      if (lockAttempts === 2) secondLockAttempted();
    });
    const administrator = createService(vendor, undefined, source);
    const scheduler = createService(vendor, undefined, source);

    const first = administrator.requery(
      principal(admin.id),
      printer.id,
      { operationPassword: PASSWORD },
      key,
    );
    await vendorEntered;
    const concurrentOperation = scheduler.reconcileStaleBatch();
    await secondLockAttempt;
    const concurrent = await concurrentOperation;
    release();
    const completed = await first;
    const replay = await administrator.requery(
      principal(admin.id),
      printer.id,
      { operationPassword: PASSWORD },
      key,
    );

    console.log('recovery advisory MySQL CONNECTION_IDs', connectionIds);
    expect(concurrent).toEqual({ processed: 0, skipped: 1, unknown: 0 });
    expect(vendor.queryOnline).toHaveBeenCalledTimes(1);
    expect(connectionIds).toHaveLength(2);
    expect(new Set(connectionIds).size).toBeGreaterThanOrEqual(2);
    expect(connectionIds[0]).not.toBe(connectionIds[1]);
    expect(replay).toEqual(completed);
  });

  it('persists UNKNOWN then fails the current bind key when send success was not proven, without mutation replay', async () => {
    const originalKey = newKey();
    const printer = await insertPrinter('SN-Recovery-Original', {
      bindingIdempotencyKey: originalKey,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      verificationCodeHash: 'bcrypt-hash',
      verificationExpiresAt: new Date(now.getTime() + 60_000),
    });
    const operationRepository = requireDatabase().getRepository(
      AdminOperationIdempotency,
    );
    const original = await operationRepository.save(
      operationRepository.create({
        adminId: admin.id,
        operation: 'CLOUD_PRINTER_BIND',
        key: originalKey,
        requestHash: 'a'.repeat(64),
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: printer.id,
        responseSnapshot: null,
      }),
    );
    await requireDatabase().getRepository(CloudPrinter).update(printer.id, {
      bindingOperationId: original.id,
    });
    const vendor = createVendor();
    const service = createService(vendor);

    await service.requery(
      principal(admin.id),
      printer.id,
      { operationPassword: PASSWORD },
      newKey(),
    );

    const reconciledOriginal = await operationRepository.findOneByOrFail({
      adminId: admin.id,
      operation: 'CLOUD_PRINTER_BIND',
      key: originalKey,
    });
    expect(reconciledOriginal).toMatchObject({
      status: 'FAILED',
      responseSnapshot: {
        printerId: printer.id,
        code: 'RECOVERY_REQUIRED',
      },
    });
    expect(vendor.addPrinter).not.toHaveBeenCalled();
    expect(vendor.print).not.toHaveBeenCalled();
    expect(vendor.deletePrinter).not.toHaveBeenCalled();
  });

  it('bindingOperationId converges only the precise target among same UUID cross-admin and cross-operation UNKNOWN candidates', async () => {
    const sharedKey = newKey();
    const otherAdmin = await requireDatabase()
      .getRepository(AdminUser)
      .save(
        requireDatabase().getRepository(AdminUser).create({
          username: 'cloud-printer-recovery-other@example.com',
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
    const printer = await insertPrinter('SN-Recovery-Precise', {
      bindingIdempotencyKey: sharedKey,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      verificationCodeHash: 'bcrypt-hash',
      verificationExpiresAt: new Date(now.getTime() + 60_000),
    });
    const operationRepository = requireDatabase().getRepository(
      AdminOperationIdempotency,
    );
    const target = await operationRepository.save(
      operationRepository.create({
        adminId: admin.id,
        operation: 'CLOUD_PRINTER_BIND',
        key: sharedKey,
        requestHash: 'a'.repeat(64),
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: printer.id,
        responseSnapshot: null,
      }),
    );
    const crossAdmin = await operationRepository.save(
      operationRepository.create({
        adminId: otherAdmin.id,
        operation: 'CLOUD_PRINTER_BIND',
        key: sharedKey,
        requestHash: 'b'.repeat(64),
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: printer.id,
        responseSnapshot: null,
      }),
    );
    const crossOperation = await operationRepository.save(
      operationRepository.create({
        adminId: admin.id,
        operation: 'CLOUD_PRINTER_RESEND',
        key: sharedKey,
        requestHash: 'c'.repeat(64),
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: printer.id,
        responseSnapshot: null,
      }),
    );
    await requireDatabase().getRepository(CloudPrinter).update(printer.id, {
      bindingOperationId: target.id,
    });

    await createService(createVendor()).requery(
      principal(admin.id),
      printer.id,
      { operationPassword: PASSWORD },
      newKey(),
    );

    expect(
      await operationRepository.findOneByOrFail({ id: target.id }),
    ).toMatchObject({
      status: 'FAILED',
    });
    expect(
      await operationRepository.findOneByOrFail({ id: crossAdmin.id }),
    ).toMatchObject({ status: 'UNKNOWN' });
    expect(
      await operationRepository.findOneByOrFail({ id: crossOperation.id }),
    ).toMatchObject({ status: 'UNKNOWN' });
  });

  it('same-key requery UNKNOWN converges itself by queryOnline while preserving one idempotency record', async () => {
    const printer = await insertPrinter('SN-Recovery-Same-Key');
    const key = newKey();
    const queryOnline = vi
      .fn()
      .mockRejectedValueOnce(vendorError('UNKNOWN'))
      .mockResolvedValueOnce({ status: 'OFFLINE' as const, vendorCode: '0' });
    const service = createService(createVendor({ queryOnline }));

    await expect(
      service.requery(
        principal(admin.id),
        printer.id,
        { operationPassword: PASSWORD },
        key,
      ),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN },
    });
    const recovered = await service.requery(
      principal(admin.id),
      printer.id,
      { operationPassword: PASSWORD },
      key,
    );

    expect(recovered.printer.onlineStatus).toBe(
      CloudPrinterOnlineStatus.OFFLINE,
    );
    expect(queryOnline).toHaveBeenCalledTimes(2);
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .count({
          where: {
            adminId: admin.id,
            operation: 'CLOUD_PRINTER_REQUERY',
            key,
          },
        }),
    ).toBe(1);
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneByOrFail({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_REQUERY',
          key,
        }),
    ).toMatchObject({ status: 'COMPLETED' });
  });

  it('rolls back requery state, idempotency, and audit together on a real audit FK failure, then releases the lock for a new key', async () => {
    const printer = await insertPrinter('SN-Recovery-Requery-Rollback');
    const failedKey = newKey();
    const vendor = createVendor();
    const failing = createService(vendor, failingAuditService());

    await expect(
      failing.requery(
        principal(admin.id),
        printer.id,
        { operationPassword: PASSWORD },
        failedKey,
      ),
    ).rejects.toBeDefined();

    expect(
      await requireDatabase().getRepository(CloudPrinter).findOneByOrFail({
        id: printer.id,
      }),
    ).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.UNKNOWN,
      version: printer.version,
    });
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneBy({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_REQUERY',
          key: failedKey,
        }),
    ).toMatchObject({ status: 'IN_PROGRESS', responseSnapshot: null });
    expect(
      await requireDatabase()
        .getRepository(AuditLog)
        .count({
          where: { targetEntity: 'cloud_printers', targetId: printer.id },
        }),
    ).toBe(0);

    await expect(
      createService(vendor).requery(
        principal(admin.id),
        printer.id,
        { operationPassword: PASSWORD },
        newKey(),
      ),
    ).resolves.toMatchObject({
      printer: { onlineStatus: CloudPrinterOnlineStatus.ONLINE },
    });
    expect(vendor.queryOnline).toHaveBeenCalledTimes(2);
  });

  it('rolls back confirm-deletion state, idempotency, and audit together on a real audit FK failure, then releases the lock for a new key', async () => {
    const printer = await insertPrinter('SN-Recovery-Delete-Rollback', {
      bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    });
    const failedKey = newKey();
    const vendor = createVendor();

    await expect(
      createService(vendor, failingAuditService()).confirmDeletion(
        principal(admin.id),
        printer.id,
        { operationPassword: PASSWORD },
        failedKey,
      ),
    ).rejects.toBeDefined();

    expect(
      await requireDatabase().getRepository(CloudPrinter).findOneByOrFail({
        id: printer.id,
      }),
    ).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      version: printer.version,
    });
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneBy({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_CONFIRM_DELETION',
          key: failedKey,
        }),
    ).toMatchObject({ status: 'IN_PROGRESS', responseSnapshot: null });
    expect(
      await requireDatabase()
        .getRepository(AuditLog)
        .count({
          where: { targetEntity: 'cloud_printers', targetId: printer.id },
        }),
    ).toBe(0);

    await expect(
      createService(vendor).confirmDeletion(
        principal(admin.id),
        printer.id,
        { operationPassword: PASSWORD },
        newKey(),
      ),
    ).resolves.toMatchObject({
      printer: { status: CloudPrinterStatus.UNBOUND },
    });
    expect(vendor.deletePrinter).toHaveBeenCalledTimes(2);
  });

  it('commits UNKNOWN recovery and releases the advisory lock before throwing so a later explicit query can recover', async () => {
    const printer = await insertPrinter('SN-Recovery-LockRelease');
    const queryOnline = vi
      .fn()
      .mockRejectedValueOnce(vendorError('UNKNOWN'))
      .mockResolvedValueOnce({ status: 'ONLINE' as const, vendorCode: '0' });
    const service = createService(createVendor({ queryOnline }));

    await expect(
      service.requery(
        principal(admin.id),
        printer.id,
        { operationPassword: PASSWORD },
        newKey(),
      ),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN },
    });
    expect(
      await requireDatabase().getRepository(CloudPrinter).findOneByOrFail({
        id: printer.id,
      }),
    ).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      vendorRelationState: VendorRelationState.UNKNOWN,
    });

    await expect(
      service.requery(
        principal(admin.id),
        printer.id,
        { operationPassword: PASSWORD },
        newKey(),
      ),
    ).resolves.toMatchObject({
      printer: { onlineStatus: CloudPrinterOnlineStatus.ONLINE },
    });
    expect(queryOnline).toHaveBeenCalledTimes(2);
  });

  it('same-key UNKNOWN delete confirmation reconciles by queryOnline and never deletes twice', async () => {
    const printer = await insertPrinter('SN-Recovery-Delete-Unknown', {
      bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
    });
    const key = newKey();
    const deletePrinter = vi.fn(async () => {
      throw vendorError('UNKNOWN');
    });
    const queryOnline = vi.fn(async () => {
      throw vendorError('FAILED', '1002');
    });
    const service = createService(createVendor({ deletePrinter, queryOnline }));

    await expect(
      service.confirmDeletion(
        principal(admin.id),
        printer.id,
        { operationPassword: PASSWORD },
        key,
      ),
    ).rejects.toMatchObject({
      response: { code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN },
    });
    await expect(
      service.confirmDeletion(
        principal(admin.id),
        printer.id,
        { operationPassword: PASSWORD },
        key,
      ),
    ).resolves.toMatchObject({
      printer: { status: CloudPrinterStatus.UNBOUND },
    });

    expect(deletePrinter).toHaveBeenCalledTimes(1);
    expect(queryOnline).toHaveBeenCalledTimes(1);
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneByOrFail({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_CONFIRM_DELETION',
          key,
        }),
    ).toMatchObject({ status: 'COMPLETED' });
  });

  it('same-key UNKNOWN delete confirmation stays UNKNOWN on unknown query and still deletes only once', async () => {
    const printer = await insertPrinter('SN-Recovery-Delete-Still-Unknown', {
      bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
    });
    const key = newKey();
    const deletePrinter = vi.fn(async () => {
      throw vendorError('UNKNOWN');
    });
    const queryOnline = vi.fn(async () => {
      throw vendorError('UNKNOWN');
    });
    const service = createService(createVendor({ deletePrinter, queryOnline }));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        service.confirmDeletion(
          principal(admin.id),
          printer.id,
          { operationPassword: PASSWORD },
          key,
        ),
      ).rejects.toMatchObject({
        response: { code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN },
      });
    }

    expect(deletePrinter).toHaveBeenCalledTimes(1);
    expect(queryOnline).toHaveBeenCalledTimes(1);
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneByOrFail({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_CONFIRM_DELETION',
          key,
        }),
    ).toMatchObject({ status: 'UNKNOWN' });
  });

  it('confirms compensation deletion once and stores audit/state/idempotency atomically', async () => {
    const printer = await insertPrinter('SN-Recovery-Delete', {
      bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
    });
    const key = newKey();
    const vendor = createVendor();
    const service = createService(vendor);

    const first = await service.confirmDeletion(
      principal(admin.id),
      printer.id,
      { operationPassword: PASSWORD },
      key,
    );
    const replay = await service.confirmDeletion(
      principal(admin.id),
      printer.id,
      { operationPassword: PASSWORD },
      key,
    );

    expect(first.printer.status).toBe(CloudPrinterStatus.UNBOUND);
    expect(replay).toEqual(first);
    expect(vendor.deletePrinter).toHaveBeenCalledTimes(1);
    expect(
      await requireDatabase()
        .getRepository(AdminOperationIdempotency)
        .findOneByOrFail({
          adminId: admin.id,
          operation: 'CLOUD_PRINTER_CONFIRM_DELETION',
          key,
        }),
    ).toMatchObject({ status: 'COMPLETED', resourceId: printer.id });
    const audit = await requireDatabase()
      .getRepository(AuditLog)
      .findOneByOrFail({
        targetEntity: 'cloud_printers',
        targetId: printer.id,
        action: 'CLOUD_PRINTER_COMPENSATION_DELETE_CONFIRMED',
      });
    expect(JSON.stringify(audit)).not.toContain('SN-Recovery-Delete');
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });
});
