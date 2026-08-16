import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  ManualPrintResolution,
  PrintBatchStatus,
  PrintJobStatus,
  PrinterBindingStage,
  PRINTING_API_ERROR_CODES,
  VendorRelationState,
  type BindCloudPrinterRequest,
  type BindCloudPrinterResult,
  type CloudPrinterListQuery,
  type CloudPrinterListResult,
  type CloudPrinterView,
  type CurrentCloudPrinterView,
  type SetCurrentCloudPrinterClientRequest,
  type SetCurrentCloudPrinterRequest,
  type SetCurrentCloudPrinterResult,
  type ClearCurrentCloudPrinterClientRequest,
  type ClearCurrentCloudPrinterRequest,
  type ClearCurrentCloudPrinterResult,
  type ConfirmCloudPrinterRequest,
  type ConfirmCloudPrinterResult,
  type ConfirmCloudPrinterCompensationDeletionRequest,
  type ConfirmCloudPrinterCompensationDeletionResult,
  type AppendPrintBatchClientRequest,
  type AppendPrintBatchRequest,
  type AppendPrintBatchResult,
  type CancelPrintBatchClientRequest,
  type CancelPrintBatchRequest,
  type CancelPrintBatchResult,
  type CreatePrintBatchClientRequest,
  type CreatePrintBatchRequest,
  type CreatePrintBatchResult,
  type CreateSinglePrintClientRequest,
  type CreateSinglePrintRequest,
  type CreateSinglePrintResult,
  type DuplicateRiskPrintRetryClientRequest,
  type DuplicateRiskPrintRetryRequest,
  type DuplicateRiskPrintRetryResult,
  type FailedPrintRetryClientRequest,
  type FailedPrintRetryRequest,
  type FailedPrintRetryResult,
  type IdempotentPrintingWrite,
  type ManualPrintResolutionClientRequest,
  type ManualPrintResolutionRequest,
  type ManualPrintResolutionResult,
  type PrintBatchListQuery,
  type PrintBatchListResult,
  type PrintBatchView,
  type PrintJobListQuery,
  type PrintJobListResult,
  type PrintJobView,
  type PrintingApiErrorCode,
  type ProcessPrintBatchClientRequest,
  type ProcessPrintBatchRequest,
  type ProcessPrintBatchResult,
  type QueryUnknownPrintJobClientRequest,
  type QueryUnknownPrintJobRequest,
  type QueryUnknownPrintJobResult,
  type RefreshCloudPrinterOnlineStatusRequest,
  type RefreshCloudPrinterOnlineStatusResult,
  type RenameCloudPrinterRequest,
  type RenameCloudPrinterResult,
  type RequeryCloudPrinterVendorRelationRequest,
  type RequeryCloudPrinterVendorRelationResult,
  type ResendCloudPrinterVerificationRequest,
  type ResendCloudPrinterVerificationResult,
  type SealPrintBatchClientRequest,
  type SealPrintBatchRequest,
  type SealPrintBatchResult,
} from './index.js';
// @ts-expect-error 恢复厂商关系仅导出语义明确的 canonical 请求契约。
import type { RequeryCloudPrinterRequest } from './index.js';
// @ts-expect-error 恢复厂商关系仅导出语义明确的 canonical 响应契约。
import type { RequeryCloudPrinterResult } from './index.js';
// @ts-expect-error 补偿删除确认不得导出易与解绑混淆的请求别名。
import type { ConfirmCloudPrinterDeletionRequest } from './index.js';
// @ts-expect-error 补偿删除确认不得导出易与解绑混淆的响应别名。
import type { ConfirmCloudPrinterDeletionResult } from './index.js';
import type {
  UnbindCloudPrinterRequest,
  UnbindCloudPrinterResult,
} from './index.js';

const verificationFailedErrorCode: PrintingApiErrorCode =
  ApiErrorCode.ADMIN_VERIFICATION_FAILED;
const verificationRateLimitedErrorCode: PrintingApiErrorCode =
  ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED;
const permissionDeniedErrorCode: PrintingApiErrorCode =
  ApiErrorCode.ADMIN_PERMISSION_DENIED;
const completePrintingErrorCodes: readonly PrintingApiErrorCode[] =
  PRINTING_API_ERROR_CODES;
// @ts-expect-error 非打印域错误码不得进入 PrintingApiErrorCode。
const nonPrintingErrorCode: PrintingApiErrorCode = ApiErrorCode.PHONE_REQUIRED;

const bindRequest: BindCloudPrinterRequest = {
  serialNumber: 'SN-AbC-123',
  displayName: '前台',
  operationPassword: '123456',
};
const bindWithIdempotencyKey: BindCloudPrinterRequest = {
  serialNumber: 'SN123',
  displayName: '前台',
  operationPassword: '123456',
  // @ts-expect-error Idempotency-Key 仅通过 HTTP header 传递。
  idempotencyKey: 'operation-key',
};
// @ts-expect-error 绑定必须携带管理员操作密码。
const bindWithoutPassword: BindCloudPrinterRequest = {
  serialNumber: 'SN123',
  displayName: '前台',
};

const confirmRequest: ConfirmCloudPrinterRequest = {
  challengeId: 'challenge-1',
  code: '123456',
  operationPassword: '123456',
};
// @ts-expect-error 确认纸面验证码必须携带 challengeId。
const confirmWithoutChallenge: ConfirmCloudPrinterRequest = {
  code: '123456',
  operationPassword: '123456',
};
const confirmWithIdempotencyKey: ConfirmCloudPrinterRequest = {
  challengeId: 'challenge-1',
  code: '123456',
  operationPassword: '123456',
  // @ts-expect-error Idempotency-Key 不能进入确认请求 body。
  idempotencyKey: 'operation-key',
};
// @ts-expect-error 确认纸面验证码必须携带 code。
const confirmWithoutCode: ConfirmCloudPrinterRequest = {
  challengeId: 'challenge-1',
  operationPassword: '123456',
};

const resendRequest: ResendCloudPrinterVerificationRequest = {
  operationPassword: '123456',
};
const resendWithIdempotencyKey: ResendCloudPrinterVerificationRequest = {
  operationPassword: '123456',
  // @ts-expect-error Idempotency-Key 不能进入重发请求 body。
  idempotencyKey: 'operation-key',
};
const refreshOnlineRequest: RefreshCloudPrinterOnlineStatusRequest = {};
const refreshOnlineWithIdempotencyKey: RefreshCloudPrinterOnlineStatusRequest =
  {
    // @ts-expect-error Idempotency-Key 不能进入在线刷新请求 body。
    idempotencyKey: 'operation-key',
  };
const requeryVendorRelationRequest: RequeryCloudPrinterVendorRelationRequest = {
  operationPassword: '123456',
};
const requeryWithIdempotencyKey: RequeryCloudPrinterVendorRelationRequest = {
  operationPassword: '123456',
  // @ts-expect-error Idempotency-Key 不能进入厂商关系恢复请求 body。
  idempotencyKey: 'operation-key',
};
const compensationDeleteRequest: ConfirmCloudPrinterCompensationDeletionRequest =
  {
    operationPassword: '123456',
  };
const compensationDeleteWithIdempotencyKey: ConfirmCloudPrinterCompensationDeletionRequest =
  {
    operationPassword: '123456',
    // @ts-expect-error Idempotency-Key 不能进入补偿删除确认请求 body。
    idempotencyKey: 'operation-key',
  };
const renameRequest: RenameCloudPrinterRequest = { displayName: '后厨' };
const renameWithPassword: RenameCloudPrinterRequest = {
  displayName: '后厨',
  // @ts-expect-error 重命名不要求操作密码。
  operationPassword: '123456',
};
const renameWithIdempotencyKey: RenameCloudPrinterRequest = {
  displayName: '后厨',
  // @ts-expect-error Idempotency-Key 不能进入重命名请求 body。
  idempotencyKey: 'operation-key',
};
const listQuery: CloudPrinterListQuery = { page: 1, pageSize: 20 };
const listIncludingUnbound: CloudPrinterListQuery = {
  page: 1,
  pageSize: 20,
  includeUnbound: true,
};
const listByStatus: CloudPrinterListQuery = {
  page: 1,
  pageSize: 20,
  status: CloudPrinterStatus.UNBOUND,
};

const printer: CloudPrinterView = {
  id: 'printer-1',
  displayName: '前台',
  serialNumberMasked: 'SN****23',
  status: CloudPrinterStatus.PENDING_VERIFICATION,
  onlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
  lastStatusCheckedAt: null,
  bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
  vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
  isCurrent: false,
  challenge: {
    challengeId: 'printer-1',
    expiresAt: '2026-08-04T00:05:00.000Z',
    remainingAttempts: 4,
  },
};
const printerWithChallengeCode: CloudPrinterView = {
  ...printer,
  challenge: {
    ...printer.challenge!,
    // @ts-expect-error 客户端 challenge metadata 不得暴露验证码明文。
    code: '123456',
  },
};
const printerWithChallengeHash: CloudPrinterView = {
  ...printer,
  challenge: {
    ...printer.challenge!,
    // @ts-expect-error 客户端 challenge metadata 不得暴露验证码 hash。
    verificationCodeHash: 'hash',
  },
};
const printerWithFullSerial: CloudPrinterView = {
  ...printer,
  // @ts-expect-error 客户端 view 不得暴露完整 SN。
  serialNumber: 'SN-AbC-123',
};
const printerWithHash: CloudPrinterView = {
  ...printer,
  // @ts-expect-error 客户端 view 不得暴露 SN hash。
  serialNumberHash: 'hash',
};
const printerWithUserKey: CloudPrinterView = {
  ...printer,
  // @ts-expect-error 客户端 view 不得暴露 UserKEY。
  userKey: 'secret',
};
const printerWithCanonicalUserKey: CloudPrinterView = {
  ...printer,
  // @ts-expect-error 客户端 view 不得暴露厂商 UserKEY。
  UserKEY: 'secret',
};
const printerWithRequestHash: CloudPrinterView = {
  ...printer,
  // @ts-expect-error 客户端 view 不得暴露请求 hash。
  requestHash: 'hash',
};
const printerWithStatusAlias: CloudPrinterView = {
  ...printer,
  // @ts-expect-error 不接受未定义的状态别名。
  status: 'VERIFICATION_PENDING',
};

const currentPrinter: CloudPrinterView = {
  ...printer,
  isCurrent: true,
  onlineStatus: CloudPrinterOnlineStatus.OFFLINE,
};
const currentView: CurrentCloudPrinterView = {
  printer: currentPrinter,
  revision: 2,
  updatedAt: '2026-08-16T00:00:00.000Z',
};
const setCurrentRequest: SetCurrentCloudPrinterRequest = {
  printerId: '18446744073709551615',
  expectedRevision: 1,
  operationPassword: '123456',
};
const setCurrentWithBodyKey: SetCurrentCloudPrinterRequest = {
  ...setCurrentRequest,
  // @ts-expect-error Idempotency-Key 只通过 HTTP header 传递。
  idempotencyKey: 'operation-key',
};
const clearCurrentRequest: ClearCurrentCloudPrinterRequest = {
  expectedRevision: 2,
  operationPassword: '123456',
};
const clearCurrentWithBodyKey: ClearCurrentCloudPrinterRequest = {
  ...clearCurrentRequest,
  // @ts-expect-error Idempotency-Key 只通过 HTTP header 传递。
  idempotencyKey: 'operation-key',
};
const setCurrentResult: SetCurrentCloudPrinterResult = { current: currentView };
const clearCurrentResult: ClearCurrentCloudPrinterResult = {
  current: { ...currentView, printer: null, revision: 3 },
};
const setCurrentClientRequest: SetCurrentCloudPrinterClientRequest = {
  headers: { 'Idempotency-Key': 'operation-key' },
  body: setCurrentRequest,
};
const clearCurrentClientRequest: ClearCurrentCloudPrinterClientRequest = {
  headers: { 'Idempotency-Key': 'operation-key' },
  body: clearCurrentRequest,
};
// @ts-expect-error current 写 client contract 必须携带 Idempotency-Key header。
const setCurrentWithoutHeader: SetCurrentCloudPrinterClientRequest = {
  body: setCurrentRequest,
};
// @ts-expect-error current 写 client contract 必须携带 Idempotency-Key header。
const clearCurrentWithoutHeader: ClearCurrentCloudPrinterClientRequest = {
  body: clearCurrentRequest,
};

const bindResult: BindCloudPrinterResult = {
  printer,
  challenge: {
    challengeId: 'challenge-1',
    expiresAt: '2026-08-04T00:05:00.000Z',
    remainingAttempts: 5,
  },
};
const bindResultWithRequestHash: BindCloudPrinterResult = {
  ...bindResult,
  // @ts-expect-error 响应不得暴露 request hash。
  requestHash: 'hash',
};
const bindResultWithFullSerial: BindCloudPrinterResult = {
  ...bindResult,
  // @ts-expect-error 响应不得暴露完整 SN。
  serialNumber: 'SN-AbC-123',
};
const bindResultWithUserKey: BindCloudPrinterResult = {
  ...bindResult,
  // @ts-expect-error 响应不得暴露厂商 UserKEY。
  UserKEY: 'secret',
};
const confirmResult: ConfirmCloudPrinterResult = { printer };
const resendResult: ResendCloudPrinterVerificationResult = {
  printer,
  challenge: bindResult.challenge,
};
const refreshOnlineResult: RefreshCloudPrinterOnlineStatusResult = { printer };
const requeryVendorRelationResult: RequeryCloudPrinterVendorRelationResult = {
  printer,
};
const compensationDeleteResult: ConfirmCloudPrinterCompensationDeletionResult =
  {
    printer,
  };
const renameResult: RenameCloudPrinterResult = { printer };
const listResult: CloudPrinterListResult = {
  items: [printer],
  total: 1,
  page: listQuery.page,
  pageSize: listQuery.pageSize,
};

void [
  verificationFailedErrorCode,
  verificationRateLimitedErrorCode,
  permissionDeniedErrorCode,
  completePrintingErrorCodes,
  nonPrintingErrorCode,
  bindRequest,
  bindWithIdempotencyKey,
  bindWithoutPassword,
  confirmRequest,
  confirmWithoutChallenge,
  confirmWithoutCode,
  confirmWithIdempotencyKey,
  resendRequest,
  resendWithIdempotencyKey,
  refreshOnlineRequest,
  refreshOnlineWithIdempotencyKey,
  requeryVendorRelationRequest,
  requeryWithIdempotencyKey,
  compensationDeleteRequest,
  compensationDeleteWithIdempotencyKey,
  renameRequest,
  renameWithPassword,
  renameWithIdempotencyKey,
  listIncludingUnbound,
  listByStatus,
  printer,
  currentPrinter,
  currentView,
  setCurrentRequest,
  setCurrentWithBodyKey,
  clearCurrentRequest,
  clearCurrentWithBodyKey,
  setCurrentResult,
  clearCurrentResult,
  setCurrentClientRequest,
  clearCurrentClientRequest,
  setCurrentWithoutHeader,
  clearCurrentWithoutHeader,
  printerWithChallengeCode,
  printerWithChallengeHash,
  printerWithFullSerial,
  printerWithHash,
  printerWithUserKey,
  printerWithCanonicalUserKey,
  printerWithRequestHash,
  printerWithStatusAlias,
  bindResult,
  bindResultWithRequestHash,
  bindResultWithFullSerial,
  bindResultWithUserKey,
  confirmResult,
  resendResult,
  refreshOnlineResult,
  requeryVendorRelationResult,
  compensationDeleteResult,
  renameResult,
  listResult,
];
void (null as unknown as RequeryCloudPrinterRequest);
void (null as unknown as RequeryCloudPrinterResult);
void (null as unknown as ConfirmCloudPrinterDeletionRequest);
void (null as unknown as ConfirmCloudPrinterDeletionResult);
void (null as unknown as UnbindCloudPrinterRequest);
void (null as unknown as UnbindCloudPrinterResult);

const completeBatchStatuses: Record<PrintBatchStatus, true> = {
  DRAFT: true,
  READY: true,
  RUNNING: true,
  PAUSED: true,
  COMPLETED: true,
  COMPLETED_WITH_ISSUES: true,
  CANCELLED: true,
};
const incompleteBatchStatuses: Record<PrintBatchStatus, true> = {
  DRAFT: true,
  READY: true,
  RUNNING: true,
  PAUSED: true,
  COMPLETED: true,
  CANCELLED: true,
  // @ts-expect-error 完整批次枚举不得遗漏 COMPLETED_WITH_ISSUES 或使用 ISSUES 别名。
  ISSUES: true,
};
const completeJobStatuses: Record<PrintJobStatus, true> = {
  PENDING: true,
  SUBMITTING: true,
  ACCEPTED: true,
  FAILED: true,
  UNKNOWN: true,
  MANUAL_REVIEW: true,
  MANUALLY_CONFIRMED_PRINTED: true,
  MANUALLY_CLOSED: true,
  CANCELLED: true,
};
const incompleteJobStatuses: Record<PrintJobStatus, true> = {
  PENDING: true,
  SUBMITTING: true,
  ACCEPTED: true,
  FAILED: true,
  UNKNOWN: true,
  MANUAL_REVIEW: true,
  MANUALLY_CONFIRMED_PRINTED: true,
  CANCELLED: true,
  // @ts-expect-error 完整 job 枚举不得遗漏 MANUALLY_CLOSED 或使用 CLOSED 别名。
  CLOSED: true,
};
// @ts-expect-error 禁止 ISSUES 状态别名。
const batchStatusAlias: PrintBatchStatus = 'ISSUES';
// @ts-expect-error 禁止 CLOSED 状态别名。
const closedJobStatusAlias: PrintJobStatus = 'CLOSED';
// @ts-expect-error 禁止 MANUAL 状态别名。
const manualJobStatusAlias: PrintJobStatus = 'MANUAL';

const batch: PrintBatchView = {
  id: 'batch-1',
  printerId: printer.id,
  createdByAdminId: 'admin-1',
  status: PrintBatchStatus.PAUSED,
  totalCount: 4,
  classifiedCount: 3,
  pendingCount: 0,
  submittingCount: 0,
  acceptedCount: 1,
  failedCount: 1,
  unknownCount: 0,
  manualReviewCount: 1,
  manuallyResolvedCount: 1,
  cancelledCount: 0,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:01:00.000Z',
};
const acceptedJob: PrintJobView = {
  id: 'job-1',
  batchId: batch.id,
  orderId: 'order-1',
  printerId: printer.id,
  sequence: 1,
  status: PrintJobStatus.ACCEPTED,
  vendorJobId: 'vendor-job-1',
  vendorErrorCode: null,
  acceptedAt: '2026-08-11T00:00:30.000Z',
  createdByAdminId: 'admin-1',
  manualResolution: null,
  manualResolutionByAdminId: null,
  manualResolutionAt: null,
  supersedesJobId: null,
  payloadRedactedAt: null,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:30.000Z',
};

const singleRequest: CreateSinglePrintRequest = {
  orderId: acceptedJob.orderId,
  printerId: printer.id,
};
const singleWithIdempotencyKey: CreateSinglePrintRequest = {
  ...singleRequest,
  // @ts-expect-error Idempotency-Key 只通过 HTTP header 传递。
  idempotencyKey: 'print-key',
};
const singleResult: CreateSinglePrintResult = {
  batch,
  job: acceptedJob,
};

const createBatchRequest: CreatePrintBatchRequest = {
  printerId: printer.id,
};
const createBatchWithPayload: CreatePrintBatchRequest = {
  printerId: printer.id,
  // @ts-expect-error 批次由服务端从订单不可变快照构造小票，不接受 payload。
  payload: { text: 'client receipt' },
};
const createBatchWithAmount: CreatePrintBatchRequest = {
  printerId: printer.id,
  // @ts-expect-error 批次创建不接受客户端金额。
  goodsTotalCents: 100,
};
const createBatchWithOrderSnapshot: CreatePrintBatchRequest = {
  printerId: printer.id,
  // @ts-expect-error 批次创建不接受客户端订单快照。
  orderSnapshot: { orderId: 'order-1' },
};
const createBatchResult: CreatePrintBatchResult = { batch };

const appendBatchRequest: AppendPrintBatchRequest = {
  orderIds: ['order-1', 'order-2'],
};
const appendBatchResult: AppendPrintBatchResult = {
  batch,
  jobs: [acceptedJob],
};
const sealBatchRequest: SealPrintBatchRequest = {};
const sealBatchResult: SealPrintBatchResult = { batch };
const processBatchRequest: ProcessPrintBatchRequest = {};
const processBatchResult: ProcessPrintBatchResult = {
  batch,
  processedCount: 4,
  accepted: 1,
  failed: 1,
  unknown: 1,
  manualReview: 1,
};
const processBatchWithSuccess: ProcessPrintBatchResult = {
  ...processBatchResult,
  // @ts-expect-error process 响应禁止 success，必须使用 accepted。
  success: 1,
};
const cancelBatchRequest: CancelPrintBatchRequest = {};
const cancelBatchResult: CancelPrintBatchResult = { batch };

const queryUnknownRequest: QueryUnknownPrintJobRequest = {};
const queryUnknownResult: QueryUnknownPrintJobResult = {
  batch,
  job: acceptedJob,
};
const failedRetryRequest: FailedPrintRetryRequest = {
  printerId: printer.id,
};
const failedRetryResult: FailedPrintRetryResult = singleResult;

const confirmPrintedResolution: ManualPrintResolutionRequest = {
  resolution: ManualPrintResolution.CONFIRM_PRINTED,
};
const confirmNotPrintedResolution: ManualPrintResolutionRequest = {
  resolution: ManualPrintResolution.CONFIRM_NOT_PRINTED,
};
const retryDuplicateRiskResolution: ManualPrintResolutionRequest = {
  resolution: ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
  printerId: printer.id,
  confirmDuplicateRisk: true,
};
const incompleteDuplicateRiskResolution: ManualPrintResolutionRequest = {
  resolution: ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
  printerId: printer.id,
  // @ts-expect-error 重复风险再次打印必须显式确认。
  confirmDuplicateRisk: false,
};
// @ts-expect-error 确认已打印不得携带重试打印机字段。
const confirmPrintedWithRetryFields: ManualPrintResolutionRequest = {
  resolution: ManualPrintResolution.CONFIRM_PRINTED,
  printerId: printer.id,
};
const confirmPrintedResolutionResult: ManualPrintResolutionResult = {
  resolution: ManualPrintResolution.CONFIRM_PRINTED,
  batch,
  job: acceptedJob,
};
const confirmNotPrintedResolutionResult: ManualPrintResolutionResult = {
  resolution: ManualPrintResolution.CONFIRM_NOT_PRINTED,
  batch,
  job: acceptedJob,
};
const duplicateRiskResolutionResult: ManualPrintResolutionResult = {
  resolution: ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
  batch,
  job: acceptedJob,
  retryBatch: batch,
  retryJob: acceptedJob,
};
// @ts-expect-error 普通人工确认不得携带 retry 资源。
const confirmPrintedResultWithRetry: ManualPrintResolutionResult = {
  resolution: ManualPrintResolution.CONFIRM_PRINTED,
  batch,
  job: acceptedJob,
  retryBatch: batch,
  retryJob: acceptedJob,
};
// @ts-expect-error 重复风险重试结果必须同时携带 retryBatch 与 retryJob。
const duplicateRiskResultWithoutRetryJob: ManualPrintResolutionResult = {
  resolution: ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
  batch,
  job: acceptedJob,
  retryBatch: batch,
};
// @ts-expect-error 重复风险重试结果必须同时携带 retryBatch 与 retryJob。
const duplicateRiskResultWithoutRetryBatch: ManualPrintResolutionResult = {
  resolution: ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
  batch,
  job: acceptedJob,
  retryJob: acceptedJob,
};
const duplicateRiskRetryRequest: DuplicateRiskPrintRetryRequest = {
  printerId: printer.id,
  confirmDuplicateRisk: true,
};
const duplicateRiskRetryResult: DuplicateRiskPrintRetryResult = {
  originalBatch: batch,
  originalJob: acceptedJob,
  retryBatch: batch,
  retryJob: acceptedJob,
};

const batchListQuery: PrintBatchListQuery = { page: 1, pageSize: 20 };
const batchListResult: PrintBatchListResult = {
  items: [batch],
  total: 1,
  page: 1,
  pageSize: 20,
};
const jobListQuery: PrintJobListQuery = {
  batchId: batch.id,
  page: 1,
  pageSize: 20,
};
const jobListResult: PrintJobListResult = {
  items: [acceptedJob],
  total: 1,
  page: 1,
  pageSize: 20,
};

const idempotencyHeaders = { 'Idempotency-Key': 'operation-key' } as const;
const singleClientRequest: CreateSinglePrintClientRequest = {
  headers: idempotencyHeaders,
  body: singleRequest,
};
// @ts-expect-error 单张打印 client contract 必须携带 Idempotency-Key header。
const singleClientWithoutHeader: CreateSinglePrintClientRequest = {
  body: singleRequest,
};
const createBatchClientRequest: CreatePrintBatchClientRequest = {
  headers: idempotencyHeaders,
  body: createBatchRequest,
};
// @ts-expect-error batch create client contract 必须携带 Idempotency-Key header。
const createBatchClientWithoutHeader: CreatePrintBatchClientRequest = {
  body: createBatchRequest,
};
const appendBatchClientRequest: AppendPrintBatchClientRequest = {
  headers: idempotencyHeaders,
  body: appendBatchRequest,
};
// @ts-expect-error batch append client contract 必须携带 Idempotency-Key header。
const appendBatchClientWithoutHeader: AppendPrintBatchClientRequest = {
  body: appendBatchRequest,
};
const sealBatchClientRequest: SealPrintBatchClientRequest = {
  headers: idempotencyHeaders,
  body: sealBatchRequest,
};
// @ts-expect-error batch seal client contract 必须携带 Idempotency-Key header。
const sealBatchClientWithoutHeader: SealPrintBatchClientRequest = {
  body: sealBatchRequest,
};
const processBatchClientRequest: ProcessPrintBatchClientRequest = {
  headers: idempotencyHeaders,
  body: processBatchRequest,
};
// @ts-expect-error batch process client contract 必须携带 Idempotency-Key header。
const processBatchClientWithoutHeader: ProcessPrintBatchClientRequest = {
  body: processBatchRequest,
};
const cancelBatchClientRequest: CancelPrintBatchClientRequest = {
  headers: idempotencyHeaders,
  body: cancelBatchRequest,
};
// @ts-expect-error batch cancel client contract 必须携带 Idempotency-Key header。
const cancelBatchClientWithoutHeader: CancelPrintBatchClientRequest = {
  body: cancelBatchRequest,
};
const queryUnknownClientRequest: QueryUnknownPrintJobClientRequest = {
  headers: idempotencyHeaders,
  body: queryUnknownRequest,
};
// @ts-expect-error UNKNOWN 查询 client contract 必须携带 Idempotency-Key header。
const queryUnknownClientWithoutHeader: QueryUnknownPrintJobClientRequest = {
  body: queryUnknownRequest,
};
const manualResolutionClientRequest: ManualPrintResolutionClientRequest = {
  headers: idempotencyHeaders,
  body: confirmPrintedResolution,
};
// @ts-expect-error 人工处置 client contract 必须携带 Idempotency-Key header。
const manualResolutionClientWithoutHeader: ManualPrintResolutionClientRequest =
  {
    body: confirmPrintedResolution,
  };
const failedRetryClientRequest: FailedPrintRetryClientRequest = {
  headers: idempotencyHeaders,
  body: failedRetryRequest,
};
// @ts-expect-error FAILED retry client contract 必须携带 Idempotency-Key header。
const failedRetryClientWithoutHeader: FailedPrintRetryClientRequest = {
  body: failedRetryRequest,
};
const duplicateRiskClientRequest: DuplicateRiskPrintRetryClientRequest = {
  headers: idempotencyHeaders,
  body: duplicateRiskRetryRequest,
};
// @ts-expect-error 重复风险 retry client contract 必须携带 Idempotency-Key header。
const duplicateRiskClientWithoutHeader: DuplicateRiskPrintRetryClientRequest = {
  body: duplicateRiskRetryRequest,
};
const genericIdempotentWrite: IdempotentPrintingWrite<CreatePrintBatchRequest> =
  createBatchClientRequest;
const bodyWithIdempotencyKey = {
  printerId: printer.id,
  idempotencyKey: 'body-key',
};
const genericWriteWithBodyIdempotencyKey: IdempotentPrintingWrite<CreatePrintBatchRequest> =
  {
    headers: idempotencyHeaders,
    // @ts-expect-error 通用打印写契约也必须拒绝中间变量中的 body idempotencyKey。
    body: bodyWithIdempotencyKey,
  };

void [
  completeBatchStatuses,
  incompleteBatchStatuses,
  completeJobStatuses,
  incompleteJobStatuses,
  batchStatusAlias,
  closedJobStatusAlias,
  manualJobStatusAlias,
  singleWithIdempotencyKey,
  createBatchWithPayload,
  createBatchWithAmount,
  createBatchWithOrderSnapshot,
  createBatchResult,
  appendBatchResult,
  sealBatchResult,
  processBatchWithSuccess,
  cancelBatchResult,
  queryUnknownResult,
  failedRetryResult,
  confirmNotPrintedResolution,
  retryDuplicateRiskResolution,
  incompleteDuplicateRiskResolution,
  confirmPrintedWithRetryFields,
  confirmPrintedResolutionResult,
  confirmNotPrintedResolutionResult,
  duplicateRiskResolutionResult,
  confirmPrintedResultWithRetry,
  duplicateRiskResultWithoutRetryJob,
  duplicateRiskResultWithoutRetryBatch,
  duplicateRiskRetryResult,
  batchListQuery,
  batchListResult,
  jobListQuery,
  jobListResult,
  singleClientRequest,
  singleClientWithoutHeader,
  createBatchClientWithoutHeader,
  appendBatchClientRequest,
  appendBatchClientWithoutHeader,
  sealBatchClientRequest,
  sealBatchClientWithoutHeader,
  processBatchClientRequest,
  processBatchClientWithoutHeader,
  cancelBatchClientRequest,
  cancelBatchClientWithoutHeader,
  queryUnknownClientRequest,
  queryUnknownClientWithoutHeader,
  manualResolutionClientRequest,
  manualResolutionClientWithoutHeader,
  failedRetryClientRequest,
  failedRetryClientWithoutHeader,
  duplicateRiskClientRequest,
  duplicateRiskClientWithoutHeader,
  genericIdempotentWrite,
  genericWriteWithBodyIdempotencyKey,
];
