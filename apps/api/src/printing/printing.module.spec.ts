import 'reflect-metadata';

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AuditService } from '../audit/audit.service.js';
import { AdminVerificationService } from '../auth/admin-verification.service.js';
import { AdminOperationIdempotency } from '../database/entities/admin-operation-idempotency.entity.js';
import { AdminCloudPrintersController } from './admin-cloud-printers.controller.js';
import { AdminPrintJobsController } from './admin-print-jobs.controller.js';
import { AdminOperationIdempotencyService } from './admin-operation-idempotency.service.js';
import { CloudPrinterReconciliationScheduler } from './cloud-printer-reconciliation.scheduler.js';
import { CloudPrinterReconciliationService } from './cloud-printer-reconciliation.service.js';
import { CloudPrinterService } from './cloud-printer.service.js';
import { PrintBatchService } from './print-batch.service.js';
import { PrintJobService } from './print-job.service.js';
import { PrintingModule } from './printing.module.js';
import { XpyunAdapter } from './xpyun/xpyun.adapter.js';
import { XPYUN_VENDOR_PORT } from './xpyun/xpyun.types.js';

const repository = {
  find: vi.fn(),
  findOne: vi.fn(),
  insert: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
};

const dataSource = {
  entityMetadatas: [],
  options: { type: 'mysql' },
  getRepository: vi.fn(() => repository),
  createQueryRunner: vi.fn(),
  transaction: vi.fn(),
};

const config = {
  get: vi.fn((key: string) => {
    if (key !== 'appEnv') return undefined;
    return {
      JWT_USER_SECRET: 'test-user-secret-at-least-16',
      JWT_ADMIN_SECRET: 'test-admin-secret-at-least-16',
      ADMIN_OPERATION_IDEMPOTENCY_SECRET:
        'test-admin-operation-idempotency-secret-at-least-32',
      JWT_EXPIRES_IN_SECONDS: 3600,
      XPYUN_USER: 'module-test-user',
      XPYUN_USER_KEY: 'module-test-key',
      XPYUN_BASE_URL: 'https://example.invalid',
      XPYUN_TIMEOUT_MS: 1000,
    };
  }),
};

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [() => ({ appEnv: config.get('appEnv') })],
    }),
  ],
  providers: [{ provide: DataSource, useValue: dataSource }],
  exports: [DataSource],
})
class TestInfrastructureModule {}

describe('Printing dependency injection', () => {
  it('does not compile the idempotency service without ConfigService', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          AdminOperationIdempotencyService,
          {
            provide: getRepositoryToken(AdminOperationIdempotency),
            useValue: repository,
          },
        ],
      })
        .overrideProvider(AdminOperationIdempotencyService)
        .useClass(AdminOperationIdempotencyService)
        .compile(),
    ).rejects.toThrow(/ConfigService/iu);
  });

  it('compiles the real PrintingModule and preserves the Xpyun useExisting alias', async () => {
    const builder = Test.createTestingModule({
      imports: [TestInfrastructureModule, PrintingModule],
    })
      .overrideProvider(AdminVerificationService)
      .useValue({ verifyPassword: vi.fn() })
      .overrideProvider(AuditService)
      .useValue({ record: vi.fn() });

    const moduleRef = await builder.compile();

    const adapter = moduleRef.get(XpyunAdapter);
    expect(adapter).toBeInstanceOf(XpyunAdapter);
    expect(moduleRef.get(XPYUN_VENDOR_PORT)).toBe(adapter);
    expect(moduleRef.get(CloudPrinterService)).toBeInstanceOf(
      CloudPrinterService,
    );
    expect(moduleRef.get(CloudPrinterReconciliationService)).toBeInstanceOf(
      CloudPrinterReconciliationService,
    );
    const scheduler = moduleRef.get(CloudPrinterReconciliationScheduler);
    expect(scheduler).toBeInstanceOf(CloudPrinterReconciliationScheduler);
    expect(moduleRef.get(AdminCloudPrintersController)).toBeInstanceOf(
      AdminCloudPrintersController,
    );
    expect(moduleRef.get(AdminPrintJobsController)).toBeInstanceOf(
      AdminPrintJobsController,
    );
    expect(moduleRef.get(PrintJobService)).toBeInstanceOf(PrintJobService);
    expect(moduleRef.get(PrintBatchService)).toBeInstanceOf(PrintBatchService);

    await moduleRef.init();
    expect(repository.find).not.toHaveBeenCalled();
    await moduleRef.close();
    expect(repository.find).not.toHaveBeenCalled();
  });
});
