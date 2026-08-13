import {
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  ManualPrintResolution,
  PrintBatchStatus,
  PrintJobStatus,
  PrinterBindingStage,
  VendorRelationState,
} from './enums.js';
import type { PaginatedView } from './admin-list.js';

export const CLOUD_PRINTER_SERIAL_NUMBER_PATTERN = /^[A-Za-z0-9-]{1,64}$/u;
export const CLOUD_PRINTER_DISPLAY_NAME_MAX_LENGTH = 64;

export function normalizeCloudPrinterSerialNumber(
  value: string,
): string | null {
  const normalized = value.trim();
  return CLOUD_PRINTER_SERIAL_NUMBER_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function normalizeCloudPrinterDisplayName(value: string): string | null {
  const normalized = value.trim();
  const codePointLength = Array.from(normalized).length;
  return codePointLength >= 1 &&
    codePointLength <= CLOUD_PRINTER_DISPLAY_NAME_MAX_LENGTH
    ? normalized
    : null;
}

export function displayNameContainsSensitiveSerial(
  displayName: string,
  serialNumber: string,
): boolean {
  const normalizedDisplayName = displayName.trim().toLowerCase();
  const normalizedSerialNumber = serialNumber.trim().toLowerCase();
  return normalizedSerialNumber.length <= 4
    ? normalizedDisplayName === normalizedSerialNumber
    : normalizedDisplayName.includes(normalizedSerialNumber);
}

export type PrinterVerificationChallengeView = {
  challengeId: string;
  expiresAt: string;
  remainingAttempts: number;
};

export type CloudPrinterView = {
  id: string;
  displayName: string;
  serialNumberMasked: string;
  status: CloudPrinterStatus;
  onlineStatus: CloudPrinterOnlineStatus;
  lastStatusCheckedAt: string | null;
  bindingStage?: PrinterBindingStage;
  vendorRelationState?: VendorRelationState;
  challenge?: PrinterVerificationChallengeView;
};

export type BindCloudPrinterRequest = {
  serialNumber: string;
  displayName: string;
  operationPassword: string;
};

export type BindCloudPrinterResult = {
  printer: CloudPrinterView;
  challenge: PrinterVerificationChallengeView;
};

export type ConfirmCloudPrinterRequest = {
  challengeId: string;
  code: string;
  operationPassword: string;
};

export type ConfirmCloudPrinterResult = {
  printer: CloudPrinterView;
};

export type ResendCloudPrinterVerificationRequest = {
  operationPassword: string;
};

export type ResendCloudPrinterVerificationResult = {
  printer: CloudPrinterView;
  challenge: PrinterVerificationChallengeView;
};

export type RefreshCloudPrinterOnlineStatusRequest = Record<string, never>;

export type RefreshCloudPrinterOnlineStatusResult = {
  printer: CloudPrinterView;
};

export type RequeryCloudPrinterVendorRelationRequest = {
  operationPassword: string;
};

export type RequeryCloudPrinterVendorRelationResult = {
  printer: CloudPrinterView;
};

export type ConfirmCloudPrinterCompensationDeletionRequest = {
  operationPassword: string;
};

export type ConfirmCloudPrinterCompensationDeletionResult = {
  printer: CloudPrinterView;
};

export type RenameCloudPrinterRequest = {
  displayName: string;
};

export type RenameCloudPrinterResult = {
  printer: CloudPrinterView;
};

export type UnbindCloudPrinterRequest = {
  operationPassword: string;
};

export type UnbindCloudPrinterResult = {
  printer: CloudPrinterView;
};

export type CloudPrinterListQuery = {
  page: number;
  pageSize: number;
  includeUnbound?: boolean;
};

export type CloudPrinterListResult = PaginatedView<CloudPrinterView>;

const PRINT_BATCH_TRANSITIONS: Readonly<
  Record<PrintBatchStatus, readonly PrintBatchStatus[]>
> = {
  [PrintBatchStatus.DRAFT]: [
    PrintBatchStatus.READY,
    PrintBatchStatus.CANCELLED,
  ],
  [PrintBatchStatus.READY]: [
    PrintBatchStatus.RUNNING,
    PrintBatchStatus.CANCELLED,
  ],
  [PrintBatchStatus.RUNNING]: [
    PrintBatchStatus.PAUSED,
    PrintBatchStatus.COMPLETED,
    PrintBatchStatus.COMPLETED_WITH_ISSUES,
  ],
  [PrintBatchStatus.PAUSED]: [
    PrintBatchStatus.RUNNING,
    PrintBatchStatus.COMPLETED,
    PrintBatchStatus.COMPLETED_WITH_ISSUES,
    PrintBatchStatus.CANCELLED,
  ],
  [PrintBatchStatus.COMPLETED]: [],
  [PrintBatchStatus.COMPLETED_WITH_ISSUES]: [],
  [PrintBatchStatus.CANCELLED]: [],
};

const PRINT_JOB_TRANSITIONS: Readonly<
  Record<PrintJobStatus, readonly PrintJobStatus[]>
> = {
  [PrintJobStatus.PENDING]: [
    PrintJobStatus.SUBMITTING,
    PrintJobStatus.CANCELLED,
  ],
  [PrintJobStatus.SUBMITTING]: [
    PrintJobStatus.ACCEPTED,
    PrintJobStatus.FAILED,
    PrintJobStatus.UNKNOWN,
  ],
  [PrintJobStatus.ACCEPTED]: [],
  [PrintJobStatus.FAILED]: [],
  [PrintJobStatus.UNKNOWN]: [
    PrintJobStatus.ACCEPTED,
    PrintJobStatus.FAILED,
    PrintJobStatus.MANUAL_REVIEW,
  ],
  [PrintJobStatus.MANUAL_REVIEW]: [
    PrintJobStatus.MANUALLY_CONFIRMED_PRINTED,
    PrintJobStatus.FAILED,
    PrintJobStatus.MANUALLY_CLOSED,
  ],
  [PrintJobStatus.MANUALLY_CONFIRMED_PRINTED]: [],
  [PrintJobStatus.MANUALLY_CLOSED]: [],
  [PrintJobStatus.CANCELLED]: [],
};

export function canTransitionPrintBatch(
  from: PrintBatchStatus,
  to: PrintBatchStatus,
): boolean {
  return PRINT_BATCH_TRANSITIONS[from].includes(to);
}

export function canTransitionPrintJob(
  from: PrintJobStatus,
  to: PrintJobStatus,
): boolean {
  return PRINT_JOB_TRANSITIONS[from].includes(to);
}

export type PrintBatchView = {
  id: string;
  printerId: string;
  createdByAdminId: string;
  status: PrintBatchStatus;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  totalCount: number;
  classifiedCount: number;
  pendingCount: number;
  submittingCount: number;
  /** 厂商已接受的数量，不代表小票已经物理出纸。 */
  acceptedCount: number;
  failedCount: number;
  unknownCount: number;
  manualReviewCount: number;
  manuallyResolvedCount: number;
  cancelledCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PrintJobView = {
  id: string;
  batchId: string;
  orderId: string;
  printerId: string;
  sequence: number;
  status: PrintJobStatus;
  /** 厂商任务号仅表示可追踪提交；ACCEPTED 不代表小票已经物理出纸。 */
  vendorJobId: string | null;
  vendorErrorCode: string | null;
  /** 厂商明确接受时间，不代表物理出纸时间。 */
  acceptedAt: string | null;
  createdByAdminId: string;
  manualResolution: ManualPrintResolution | null;
  manualResolutionByAdminId: string | null;
  manualResolutionAt: string | null;
  supersedesJobId: string | null;
  payloadRedactedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSinglePrintRequest = {
  orderId: string;
  printerId: string;
};

export type CreateSinglePrintResult = {
  batch: PrintBatchView;
  job: PrintJobView;
};

/**
 * 创建 DRAFT 批次。小票 payload、金额和订单快照始终由服务端读取并构造。
 */
export type CreatePrintBatchRequest = {
  printerId: string;
};

export type CreatePrintBatchResult = {
  batch: PrintBatchView;
};

export type AppendPrintBatchRequest = {
  orderIds: string[];
};

export type AppendPrintBatchResult = {
  batch: PrintBatchView;
  jobs: PrintJobView[];
};

export type SealPrintBatchRequest = Record<string, never>;

export type SealPrintBatchResult = {
  batch: PrintBatchView;
};

export type ProcessPrintBatchRequest = Record<string, never>;

export type ProcessPrintBatchResult = {
  batch: PrintBatchView;
  processedCount: number;
  /** 本次厂商明确接受数，不代表物理出纸数。 */
  accepted: number;
  failed: number;
  unknown: number;
  manualReview: number;
};

export type CancelPrintBatchRequest = Record<string, never>;

export type CancelPrintBatchResult = {
  batch: PrintBatchView;
};

export type QueryUnknownPrintJobRequest = Record<string, never>;

export type QueryUnknownPrintJobResult = {
  batch: PrintBatchView;
  job: PrintJobView;
};

export type FailedPrintRetryRequest = {
  printerId: string;
};

export type FailedPrintRetryResult = CreateSinglePrintResult;

export type ConfirmPrintedManualPrintRequest = {
  resolution: ManualPrintResolution.CONFIRM_PRINTED;
  printerId?: never;
  confirmDuplicateRisk?: never;
};

export type ConfirmNotPrintedManualPrintRequest = {
  resolution: ManualPrintResolution.CONFIRM_NOT_PRINTED;
  printerId?: never;
  confirmDuplicateRisk?: never;
};

export type RetryWithDuplicateRiskManualPrintRequest = {
  resolution: ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK;
  printerId: string;
  confirmDuplicateRisk: true;
};

export type ManualPrintResolutionRequest =
  | ConfirmPrintedManualPrintRequest
  | ConfirmNotPrintedManualPrintRequest
  | RetryWithDuplicateRiskManualPrintRequest;

type ManualPrintResolutionResultBase = {
  batch: PrintBatchView;
  job: PrintJobView;
};

export type ConfirmPrintedManualPrintResult =
  ManualPrintResolutionResultBase & {
    resolution: ManualPrintResolution.CONFIRM_PRINTED;
    retryBatch?: never;
    retryJob?: never;
  };

export type ConfirmNotPrintedManualPrintResult =
  ManualPrintResolutionResultBase & {
    resolution: ManualPrintResolution.CONFIRM_NOT_PRINTED;
    retryBatch?: never;
    retryJob?: never;
  };

export type RetryWithDuplicateRiskManualPrintResult =
  ManualPrintResolutionResultBase & {
    resolution: ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK;
    retryBatch: PrintBatchView;
    retryJob: PrintJobView;
  };

export type ManualPrintResolutionResult =
  | ConfirmPrintedManualPrintResult
  | ConfirmNotPrintedManualPrintResult
  | RetryWithDuplicateRiskManualPrintResult;

export type DuplicateRiskPrintRetryRequest = {
  printerId: string;
  confirmDuplicateRisk: true;
};

export type DuplicateRiskPrintRetryResult = {
  originalBatch: PrintBatchView;
  originalJob: PrintJobView;
  retryBatch: PrintBatchView;
  retryJob: PrintJobView;
};

export type PrintBatchListQuery = {
  page: number;
  pageSize: number;
  status?: PrintBatchStatus;
};

export type PrintBatchListResult = PaginatedView<PrintBatchView>;

export type PrintJobListQuery = {
  batchId?: string;
  orderId?: string;
  status?: PrintJobStatus;
  page: number;
  pageSize: number;
};

export type PrintJobListResult = PaginatedView<PrintJobView>;

export type PrintingIdempotencyHeaders = {
  /** 所有打印写操作必须通过 HTTP Idempotency-Key header 传入。 */
  'Idempotency-Key': string;
};

/**
 * 打印写操作的 HTTP client contract。幂等键只在 headers 中，body 不携带 key。
 */
export type IdempotentPrintingWrite<TBody> = {
  headers: PrintingIdempotencyHeaders;
  body: TBody & { idempotencyKey?: never };
};

export type CreateSinglePrintClientRequest =
  IdempotentPrintingWrite<CreateSinglePrintRequest>;
export type CreatePrintBatchClientRequest =
  IdempotentPrintingWrite<CreatePrintBatchRequest>;
export type AppendPrintBatchClientRequest =
  IdempotentPrintingWrite<AppendPrintBatchRequest>;
export type SealPrintBatchClientRequest =
  IdempotentPrintingWrite<SealPrintBatchRequest>;
export type ProcessPrintBatchClientRequest =
  IdempotentPrintingWrite<ProcessPrintBatchRequest>;
export type CancelPrintBatchClientRequest =
  IdempotentPrintingWrite<CancelPrintBatchRequest>;
export type QueryUnknownPrintJobClientRequest =
  IdempotentPrintingWrite<QueryUnknownPrintJobRequest>;
export type ManualPrintResolutionClientRequest =
  IdempotentPrintingWrite<ManualPrintResolutionRequest>;
export type FailedPrintRetryClientRequest =
  IdempotentPrintingWrite<FailedPrintRetryRequest>;
export type DuplicateRiskPrintRetryClientRequest =
  IdempotentPrintingWrite<DuplicateRiskPrintRetryRequest>;
export type UnbindCloudPrinterClientRequest =
  IdempotentPrintingWrite<UnbindCloudPrinterRequest>;
