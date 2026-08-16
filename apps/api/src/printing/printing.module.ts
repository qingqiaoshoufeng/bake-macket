import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminOperationIdempotency } from '../database/entities/admin-operation-idempotency.entity.js';
import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import { CloudPrinterStoreSetting } from '../database/entities/cloud-printer-store-setting.entity.js';
import { OrderItem } from '../database/entities/order-item.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { PrintBatch } from '../database/entities/print-batch.entity.js';
import { PrintJob } from '../database/entities/print-job.entity.js';
import { AdminCloudPrintersController } from './admin-cloud-printers.controller.js';
import { AdminPrintJobsController } from './admin-print-jobs.controller.js';
import { AdminOperationIdempotencyService } from './admin-operation-idempotency.service.js';
import { CloudPrinterCurrentService } from './cloud-printer-current.service.js';
import { CloudPrinterReconciliationScheduler } from './cloud-printer-reconciliation.scheduler.js';
import { CloudPrinterReconciliationService } from './cloud-printer-reconciliation.service.js';
import { CloudPrinterService } from './cloud-printer.service.js';
import { PrintBatchService } from './print-batch.service.js';
import { PrintJobService } from './print-job.service.js';
import { PrintRecoveryService } from './print-recovery.service.js';
import { PrintRetentionService } from './print-retention.service.js';
import { XpyunAdapter } from './xpyun/xpyun.adapter.js';
import { XPYUN_VENDOR_PORT } from './xpyun/xpyun.types.js';

/**
 * Cloud printing module. Wires together the xpyun vendor adapter, the generic
 * administrator operation idempotency service and the cloud-printer state
 * machine. Re-uses the auth module for permission guards and the audit module
 * for outcome records; never logs secrets, never returns full serial numbers.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CloudPrinter,
      CloudPrinterStoreSetting,
      AdminOperationIdempotency,
      Order,
      OrderItem,
      PrintBatch,
      PrintJob,
    ]),
    AuthModule,
    AuditModule,
  ],
  controllers: [AdminCloudPrintersController, AdminPrintJobsController],
  providers: [
    XpyunAdapter,
    { provide: XPYUN_VENDOR_PORT, useExisting: XpyunAdapter },
    AdminOperationIdempotencyService,
    CloudPrinterCurrentService,
    CloudPrinterService,
    PrintJobService,
    PrintBatchService,
    PrintRecoveryService,
    PrintRetentionService,
    CloudPrinterReconciliationService,
    CloudPrinterReconciliationScheduler,
  ],
  exports: [
    CloudPrinterCurrentService,
    CloudPrinterService,
    CloudPrinterReconciliationService,
    AdminOperationIdempotencyService,
    PrintJobService,
    PrintBatchService,
    PrintRecoveryService,
    PrintRetentionService,
  ],
})
export class PrintingModule {}
