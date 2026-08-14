import 'reflect-metadata';

import {
  AdminRole,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  FulfillmentType,
  OrderStatus,
  PrintBatchStatus,
  PrintJobStatus,
  PrinterBindingStage,
  SUPER_ADMIN_PERMISSIONS,
  VendorRelationState,
} from '@bake-mall/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import type { AuthenticatedAdmin } from '../src/auth/auth.types.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AdminOperationIdempotency } from '../src/database/entities/admin-operation-idempotency.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import { CloudPrinter } from '../src/database/entities/cloud-printer.entity.js';
import * as entities from '../src/database/entities/index.js';
import { OrderItem } from '../src/database/entities/order-item.entity.js';
import { Order } from '../src/database/entities/order.entity.js';
import { PrintJob } from '../src/database/entities/print-job.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { PrintBatchService } from '../src/printing/print-batch.service.js';
import { PrintJobService } from '../src/printing/print-job.service.js';
import { PrintRecoveryService } from '../src/printing/print-recovery.service.js';
import type { XpyunVendorPort } from '../src/printing/cloud-printer.service.js';
import { createAdminOperationIdempotencyTestService } from './helpers/admin-operation-idempotency.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_print_batches_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
let keySequence = 1200;
const newKey = (): string =>
  `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

const NOW = new Date('2026-08-11T03:04:05.000Z');

describe.sequential('Cloud print batch services (real MySQL)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let source: DataSource | undefined;
  let adminRow: AdminUser;
  let printer: CloudPrinter;
  let order: Order;

  const requireSource = (): DataSource => {
    if (!source) throw new Error('Temporary MySQL data source unavailable');
    return source;
  };

  const principal = (): AuthenticatedAdmin => ({
    id: adminRow.id,
    username: adminRow.username,
    role: AdminRole.SUPER_ADMIN,
    linkedUserId: null,
    mustChangePassword: false,
    permissions: SUPER_ADMIN_PERMISSIONS,
  });

  const createServices = (vendor: XpyunVendorPort) => {
    const current = requireSource();
    const audit = new AuditService(current.getRepository(AuditLog));
    const printJobs = new PrintJobService(
      current,
      vendor,
      audit,
      () => new Date(NOW),
    );
    const idempotency = createAdminOperationIdempotencyTestService(
      current.getRepository(AdminOperationIdempotency),
    );
    const recovery = new PrintRecoveryService(
      current,
      idempotency,
      audit,
      {
        queryOrder: vi.fn(async () => ({ printed: false, vendorCode: '0' })),
      },
      () => new Date(NOW),
    );
    return {
      batches: new PrintBatchService(
        current,
        idempotency,
        audit,
        printJobs,
        recovery,
        () => new Date(NOW),
      ),
      printJobs,
    };
  };

  beforeAll(async () => {
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      source = new DataSource({
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
      await source.initialize();
      await source.runMigrations();

      adminRow = await source.getRepository(AdminUser).save(
        source.getRepository(AdminUser).create({
          username: 'print-batches@example.com',
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
      const user = await source.getRepository(User).save(
        source.getRepository(User).create({
          wechatOpenid: 'print-batch-openid',
          wechatUnionid: null,
          nickname: '顾客',
          avatarUrl: null,
          phone: '13800000000',
          phoneVerified: true,
          isActive: true,
          mergedIntoUserId: null,
          tokenVersion: 1,
        }),
      );
      printer = await source.getRepository(CloudPrinter).save(
        source.getRepository(CloudPrinter).create({
          serialNumber: 'SN-PRINT-BATCH-E2E',
          displayName: 'E2E 打印机',
          status: CloudPrinterStatus.ACTIVE,
          bindingStage: PrinterBindingStage.NONE,
          vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
          bindingIdempotencyKey: null,
          bindingOperationId: null,
          verificationCodeHash: null,
          verificationExpiresAt: null,
          verificationFailedAttempts: 0,
          verifiedAt: NOW,
          lastOnlineStatus: CloudPrinterOnlineStatus.ONLINE,
          lastStatusCheckedAt: NOW,
          boundByAdminId: adminRow.id,
          lastVendorErrorCode: null,
          unboundAt: null,
        }),
      );
      order = await source.getRepository(Order).save(
        source.getRepository(Order).create({
          orderNo: 'BM-PRINT-E2E-1',
          userId: user.id,
          status: OrderStatus.NEW,
          fulfillmentType: FulfillmentType.PICKUP,
          contactName: '林女士',
          contactPhone: '13800000000',
          pickupTimeText: '明天 10:00',
          deliveryAddressText: null,
          goodsTotalCents: 1_000,
          membershipDiscountCents: 0,
          creditAppliedCents: 0,
          payableTotalCents: 1_000,
          membershipId: null,
          membershipCode: null,
          membershipName: null,
          membershipDiscountBasisPoints: null,
          pricingVersion: 1,
          remark: null,
        }),
      );
      await source.getRepository(OrderItem).save(
        source.getRepository(OrderItem).create({
          orderId: order.id,
          productId: null,
          skuId: null,
          productName: 'E2E 蛋糕',
          skuName: '六寸',
          skuAttributes: { size: '六寸' },
          imageUrl: null,
          unitPriceCents: 1_000,
          quantity: 1,
          lineGoodsTotalCents: 1_000,
          lineMembershipDiscountCents: 0,
          linePayableCents: 1_000,
        }),
      );
    } catch (error) {
      try {
        if (source?.isInitialized) await source.destroy();
      } finally {
        cleanupDatabase?.();
      }
      throw error;
    }
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
  }, 60_000);

  it('create→append→seal→process 持久化并以相同 process key 稳定 replay', async () => {
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'vendor-e2e-1',
    }));
    const vendor = {
      addPrinter: vi.fn(),
      deletePrinter: vi.fn(),
      queryOnline: vi.fn(),
      print,
    } as unknown as XpyunVendorPort;
    const { batches } = createServices(vendor);
    const actor = principal();
    const created = await batches.create(
      actor,
      { printerId: printer.id },
      newKey(),
    );
    await batches.append(
      actor,
      created.batch.id,
      { orderIds: [order.id] },
      newKey(),
    );
    await batches.seal(actor, created.batch.id, newKey());
    const processKey = newKey();

    const first = await batches.process(actor, created.batch.id, processKey);
    const replay = await batches.process(actor, created.batch.id, processKey);

    expect(first).toEqual(replay);
    expect(first.batch.status).toBe(PrintBatchStatus.COMPLETED);
    expect(first.accepted).toBe(1);
    expect(print).toHaveBeenCalledTimes(1);
    expect(
      await requireSource().getRepository(PrintJob).findOneByOrFail({
        batchId: created.batch.id,
      }),
    ).toMatchObject({
      status: PrintJobStatus.ACCEPTED,
      vendorJobId: 'vendor-e2e-1',
    });
  });

  it('append 相同 key 不同 canonical request hash 返回 conflict', async () => {
    const vendor = {
      addPrinter: vi.fn(),
      deletePrinter: vi.fn(),
      queryOnline: vi.fn(),
      print: vi.fn(),
    } as unknown as XpyunVendorPort;
    const { batches } = createServices(vendor);
    const actor = principal();
    const created = await batches.create(
      actor,
      { printerId: printer.id },
      newKey(),
    );
    const key = newKey();
    await batches.append(
      actor,
      created.batch.id,
      { orderIds: [order.id] },
      key,
    );

    await expect(
      batches.append(actor, created.batch.id, { orderIds: ['999999'] }, key),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(
      await requireSource().getRepository(PrintJob).countBy({
        batchId: created.batch.id,
      }),
    ).toBe(1);
  });
});
