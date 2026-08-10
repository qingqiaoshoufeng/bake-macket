import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminOperationIdempotency } from '../database/entities/admin-operation-idempotency.entity.js';
import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import { AdminCloudPrintersController } from './admin-cloud-printers.controller.js';
import { AdminOperationIdempotencyService } from './admin-operation-idempotency.service.js';
import { CloudPrinterReconciliationScheduler } from './cloud-printer-reconciliation.scheduler.js';
import { CloudPrinterReconciliationService } from './cloud-printer-reconciliation.service.js';
import { CloudPrinterService } from './cloud-printer.service.js';
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
    TypeOrmModule.forFeature([CloudPrinter, AdminOperationIdempotency]),
    AuthModule,
    AuditModule,
  ],
  controllers: [AdminCloudPrintersController],
  providers: [
    XpyunAdapter,
    { provide: XPYUN_VENDOR_PORT, useExisting: XpyunAdapter },
    AdminOperationIdempotencyService,
    CloudPrinterService,
    CloudPrinterReconciliationService,
    CloudPrinterReconciliationScheduler,
  ],
  exports: [
    CloudPrinterService,
    CloudPrinterReconciliationService,
    AdminOperationIdempotencyService,
  ],
})
export class PrintingModule {}
