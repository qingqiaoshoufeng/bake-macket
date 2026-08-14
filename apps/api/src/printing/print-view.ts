import type { PrintBatchView, PrintJobView } from '@bake-mall/contracts';
import { PrintJobStatus } from '@bake-mall/contracts';

import { PrintBatch } from '../database/entities/print-batch.entity.js';
import { PrintJob } from '../database/entities/print-job.entity.js';

const countStatus = (
  jobs: readonly PrintJob[],
  status: PrintJobStatus,
): number => jobs.filter((job) => job.status === status).length;

export const toPrintJobView = (job: PrintJob): PrintJobView => ({
  id: job.id,
  batchId: job.batchId,
  orderId: job.orderId,
  printerId: job.printerId,
  sequence: job.sequence,
  status: job.status,
  vendorJobId: job.vendorJobId,
  vendorErrorCode: job.vendorErrorCode,
  acceptedAt: job.acceptedAt?.toISOString() ?? null,
  createdByAdminId: job.createdByAdminId,
  manualResolution: job.manualResolution,
  manualResolutionByAdminId: job.manualResolutionByAdminId,
  manualResolutionAt: job.manualResolutionAt?.toISOString() ?? null,
  supersedesJobId: job.supersedesJobId,
  payloadRedactedAt: job.payloadRedactedAt?.toISOString() ?? null,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString(),
});

export const toPrintBatchView = (
  batch: PrintBatch,
  jobs: readonly PrintJob[],
): PrintBatchView => ({
  id: batch.id,
  printerId: batch.printerId,
  createdByAdminId: batch.createdByAdminId,
  status: batch.status,
  leaseOwner: batch.leaseOwner,
  leaseExpiresAt: batch.leaseExpiresAt?.toISOString() ?? null,
  totalCount: batch.totalCount,
  classifiedCount: batch.classifiedCount,
  pendingCount: countStatus(jobs, PrintJobStatus.PENDING),
  submittingCount: countStatus(jobs, PrintJobStatus.SUBMITTING),
  acceptedCount: batch.acceptedCount,
  failedCount: batch.failedCount,
  unknownCount: countStatus(jobs, PrintJobStatus.UNKNOWN),
  manualReviewCount: batch.manualReviewCount,
  manuallyResolvedCount: batch.manuallyResolvedCount,
  cancelledCount: batch.cancelledCount,
  createdAt: batch.createdAt.toISOString(),
  updatedAt: batch.updatedAt.toISOString(),
});
