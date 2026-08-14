import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  type BindCloudPrinterRequest,
  type BindCloudPrinterResult,
  type CloudPrinterListQuery,
  type CloudPrinterListResult,
  type CloudPrinterView,
  type ConfirmCloudPrinterRequest,
  type ConfirmCloudPrinterResult,
  type ConfirmCloudPrinterCompensationDeletionRequest,
  type ConfirmCloudPrinterCompensationDeletionResult,
  type PrintingApiErrorCode,
  type RefreshCloudPrinterOnlineStatusRequest,
  type RefreshCloudPrinterOnlineStatusResult,
  type RenameCloudPrinterRequest,
  type RenameCloudPrinterResult,
  type RequeryCloudPrinterVendorRelationRequest,
  type RequeryCloudPrinterVendorRelationResult,
  type ResendCloudPrinterVerificationRequest,
  type ResendCloudPrinterVerificationResult,
} from './index.js';
// @ts-expect-error 恢复厂商关系仅导出语义明确的 canonical 请求契约。
import type { RequeryCloudPrinterRequest } from './index.js';
// @ts-expect-error 恢复厂商关系仅导出语义明确的 canonical 响应契约。
import type { RequeryCloudPrinterResult } from './index.js';
// @ts-expect-error 补偿删除确认不得导出易与解绑混淆的请求别名。
import type { ConfirmCloudPrinterDeletionRequest } from './index.js';
// @ts-expect-error 补偿删除确认不得导出易与解绑混淆的响应别名。
import type { ConfirmCloudPrinterDeletionResult } from './index.js';
// @ts-expect-error 本阶段不导出解绑请求契约。
import type { UnbindCloudPrinterRequest } from './index.js';
// @ts-expect-error 本阶段不导出解绑响应契约。
import type { UnbindCloudPrinterResult } from './index.js';

const verificationFailedErrorCode: PrintingApiErrorCode =
  ApiErrorCode.ADMIN_VERIFICATION_FAILED;
const verificationRateLimitedErrorCode: PrintingApiErrorCode =
  ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED;
const permissionDeniedErrorCode: PrintingApiErrorCode =
  ApiErrorCode.ADMIN_PERMISSION_DENIED;

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

const printer: CloudPrinterView = {
  id: 'printer-1',
  displayName: '前台',
  serialNumberMasked: 'SN****23',
  status: CloudPrinterStatus.PENDING_VERIFICATION,
  onlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
  lastStatusCheckedAt: null,
  bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
  vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
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
  printer,
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
