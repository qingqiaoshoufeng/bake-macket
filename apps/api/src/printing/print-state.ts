import { PrintBatchStatus, PrintJobStatus } from '@bake-mall/contracts';

import { PrintBatch } from '../database/entities/print-batch.entity.js';
import { PrintJob } from '../database/entities/print-job.entity.js';

const RESOLVED_JOB_STATUSES = new Set([
  PrintJobStatus.MANUALLY_CONFIRMED_PRINTED,
  PrintJobStatus.MANUALLY_CLOSED,
]);

const UNRESOLVED_JOB_STATUSES = new Set([
  PrintJobStatus.PENDING,
  PrintJobStatus.SUBMITTING,
  PrintJobStatus.UNKNOWN,
  PrintJobStatus.MANUAL_REVIEW,
]);

const countStatus = (
  jobs: readonly PrintJob[],
  status: PrintJobStatus,
): number => jobs.filter((job) => job.status === status).length;

export const applyPrintBatchCounts = (
  batch: PrintBatch,
  jobs: readonly PrintJob[],
): void => {
  batch.totalCount = jobs.length;
  batch.acceptedCount = countStatus(jobs, PrintJobStatus.ACCEPTED);
  batch.failedCount = countStatus(jobs, PrintJobStatus.FAILED);
  batch.manualReviewCount = countStatus(jobs, PrintJobStatus.MANUAL_REVIEW);
  batch.manuallyResolvedCount = jobs.filter(({ status }) =>
    RESOLVED_JOB_STATUSES.has(status),
  ).length;
  batch.cancelledCount = countStatus(jobs, PrintJobStatus.CANCELLED);
  batch.classifiedCount =
    batch.acceptedCount +
    batch.failedCount +
    batch.manuallyResolvedCount +
    batch.cancelledCount;
};

export const hasUnresolvedPrintJobs = (jobs: readonly PrintJob[]): boolean =>
  jobs.some(({ status }) => UNRESOLVED_JOB_STATUSES.has(status));

export const settledPrintBatchStatus = (
  batch: PrintBatch,
  jobs: readonly PrintJob[],
): PrintBatchStatus => {
  if (hasUnresolvedPrintJobs(jobs)) return PrintBatchStatus.PAUSED;
  return batch.failedCount +
    batch.manuallyResolvedCount +
    batch.cancelledCount >
    0
    ? PrintBatchStatus.COMPLETED_WITH_ISSUES
    : PrintBatchStatus.COMPLETED;
};
