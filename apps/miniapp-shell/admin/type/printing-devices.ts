import type {
  BindCloudPrinterRequest,
  CloudPrinterView,
  ConfirmCloudPrinterRequest,
  PrinterVerificationChallengeView,
  RenameCloudPrinterRequest,
} from '@bake-mall/contracts';

export type PrintingDeviceOperation =
  | 'bind'
  | 'confirm'
  | 'resend'
  | 'refresh'
  | 'requery'
  | 'delete-confirm'
  | 'rename';

export type PrintingDeviceAction =
  Exclude<PrintingDeviceOperation, 'bind' | 'confirm'> | 'verify';
export type PrintingDeviceOperationStatus = 'PENDING' | 'RETRYABLE' | 'UNKNOWN';

export type PendingDeviceOperation = Readonly<{
  operation: PrintingDeviceOperation;
  resourceId?: string;
  idempotencyKey: string;
  status: PrintingDeviceOperationStatus;
  wasUncertain?: true;
}>;

export type PersistedPendingDeviceOperation = Readonly<{
  operation: PrintingDeviceOperation;
  resourceId?: string;
  idempotencyKey: string;
}>;

export type PrintingDevicesDialog = Readonly<{
  kind: 'bind' | 'verify' | 'recovery' | 'rename' | null;
  resourceId?: string;
  recoveryAction?: 'resend' | 'requery' | 'delete-confirm';
}>;

export type PrintingDevicesForms = Readonly<{
  bind: BindCloudPrinterRequest;
  verify: ConfirmCloudPrinterRequest;
  recoveryPassword: string;
  rename: RenameCloudPrinterRequest;
}>;

export type PrintingDevicesState = Readonly<{
  devices: readonly CloudPrinterView[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  dialog: PrintingDevicesDialog;
  forms: PrintingDevicesForms;
  challengeByPrinterId: Readonly<
    Record<string, PrinterVerificationChallengeView>
  >;
  countdownSeconds: number;
  remainingAttempts: number;
  operations: readonly PendingDeviceOperation[];
  operationMap: Readonly<Record<string, PrintingDeviceOperationStatus>>;
  mutationGeneration: number;
  manualContinueRequired: boolean;
}>;
