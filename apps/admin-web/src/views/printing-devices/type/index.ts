import type {
  BindCloudPrinterRequest,
  BindCloudPrinterResult,
  CloudPrinterListQuery,
  CloudPrinterListResult,
  CloudPrinterView,
  ConfirmCloudPrinterCompensationDeletionRequest,
  ConfirmCloudPrinterCompensationDeletionResult,
  ConfirmCloudPrinterRequest,
  ConfirmCloudPrinterResult,
  PrinterVerificationChallengeView,
  RefreshCloudPrinterOnlineStatusRequest,
  RefreshCloudPrinterOnlineStatusResult,
  RenameCloudPrinterRequest,
  RenameCloudPrinterResult,
  RequeryCloudPrinterVendorRelationRequest,
  RequeryCloudPrinterVendorRelationResult,
  ResendCloudPrinterVerificationRequest,
  ResendCloudPrinterVerificationResult,
  UnbindCloudPrinterRequest,
  UnbindCloudPrinterResult,
} from '@bake-mall/contracts';

export type {
  BindCloudPrinterRequest,
  BindCloudPrinterResult,
  CloudPrinterListQuery,
  CloudPrinterListResult,
  CloudPrinterView,
  ConfirmCloudPrinterCompensationDeletionRequest,
  ConfirmCloudPrinterCompensationDeletionResult,
  ConfirmCloudPrinterRequest,
  ConfirmCloudPrinterResult,
  PrinterVerificationChallengeView,
  RefreshCloudPrinterOnlineStatusRequest,
  RefreshCloudPrinterOnlineStatusResult,
  RenameCloudPrinterRequest,
  RenameCloudPrinterResult,
  RequeryCloudPrinterVendorRelationRequest,
  RequeryCloudPrinterVendorRelationResult,
  ResendCloudPrinterVerificationRequest,
  ResendCloudPrinterVerificationResult,
  UnbindCloudPrinterRequest,
  UnbindCloudPrinterResult,
};

export type PrintingDeviceOperation =
  | 'bind'
  | 'confirm'
  | 'resend'
  | 'refresh'
  | 'requery'
  | 'delete-confirm'
  | 'unbind'
  | 'rename';

export type PrintingDeviceOperationStatus = 'PENDING' | 'RETRYABLE' | 'UNKNOWN';

export type PendingDeviceOperation = {
  readonly operation: PrintingDeviceOperation;
  readonly resourceId?: string;
  readonly idempotencyKey: string;
  readonly status: PrintingDeviceOperationStatus;
  readonly wasUncertain?: true;
};

export type PersistedPendingDeviceOperation = Omit<
  PendingDeviceOperation,
  'status' | 'wasUncertain'
>;

export type PrinterChallengeState =
  'available' | 'metadata-missing' | 'expired';

export type BindPrinterForm = BindCloudPrinterRequest;
export type VerifyPrinterForm = ConfirmCloudPrinterRequest;
export type RecoveryPrinterForm = RequeryCloudPrinterVendorRelationRequest;
export type RenamePrinterForm = RenameCloudPrinterRequest;

export type PrintingDeviceError = {
  readonly kind: 'stable' | 'unknown' | 'retryable';
  readonly message: string;
};
