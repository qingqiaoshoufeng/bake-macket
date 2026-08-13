import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, IsNull, LessThanOrEqual } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { PrintJob } from '../database/entities/print-job.entity.js';
import type { ReceiptPayload } from './receipt/receipt-payload.js';

const MAX_BATCH_SIZE = 1_000;

type RetentionResult = Readonly<{ scanned: number; redacted: number }>;
type RedactedPayload = Readonly<{
  schemaVersion: 1;
  redacted: true;
  orderId: string;
  totals: ReceiptPayload['totals'];
}>;

const redactedPayload = (job: PrintJob): RedactedPayload => {
  const payload = job.payloadJson as Partial<ReceiptPayload> | null;
  const totals = payload?.totals;
  if (
    !totals ||
    !Number.isSafeInteger(totals.goodsTotalCents) ||
    !Number.isSafeInteger(totals.membershipDiscountCents) ||
    !Number.isSafeInteger(totals.creditAppliedCents) ||
    !Number.isSafeInteger(totals.payableTotalCents)
  ) {
    throw new Error(`Print job ${job.id} has invalid retention totals.`);
  }
  return {
    schemaVersion: 1,
    redacted: true,
    orderId: job.orderId,
    totals: { ...totals },
  };
};

@Injectable()
export class PrintRetentionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  redactExpiredPayloads(
    cutoff: Date,
    batchSize: number,
  ): Promise<RetentionResult> {
    if (
      !Number.isFinite(cutoff.getTime()) ||
      !Number.isSafeInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new BadRequestException('Invalid print retention arguments.');
    }

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PrintJob);
      const jobs = await repository.find({
        where: {
          createdAt: LessThanOrEqual(cutoff),
          payloadRedactedAt: IsNull(),
        },
        order: { createdAt: 'ASC', id: 'ASC' },
        take: batchSize,
        lock: { mode: 'pessimistic_write' },
      });
      const redactedAt = new Date();
      const redactedJobs = jobs.map((job) =>
        Object.assign(job, {
          payloadJson: redactedPayload(job),
          payloadRedactedAt: redactedAt,
        }),
      );
      await repository.save(redactedJobs);
      await Promise.all(
        redactedJobs.map((job) =>
          this.audit.record(
            {
              actor: { type: 'SYSTEM' },
              targetEntity: 'print_jobs',
              targetId: job.id,
              action: 'PRINT_PAYLOAD_REDACTED',
              changeSummary: { orderId: job.orderId, redacted: true },
            },
            manager,
          ),
        ),
      );
      return { scanned: jobs.length, redacted: redactedJobs.length };
    });
  }
}
