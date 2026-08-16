import type {
  BindCloudPrinterRequest,
  CloudPrinterView,
  ConfirmCloudPrinterRequest,
  PrinterVerificationChallengeView,
  RenameCloudPrinterRequest,
  CurrentCloudPrinterView,
} from '@bake-mall/contracts';

export type PrintingDeviceOperation =
  | 'bind'
  | 'confirm'
  | 'resend'
  | 'refresh'
  | 'requery'
  | 'delete-confirm'
  | 'unbind'
  | 'rename'
  | 'set-current'
  | 'clear-current';

export type PrintingDeviceAction =
  Exclude<PrintingDeviceOperation, 'bind' | 'confirm'> | 'verify' | 'detail';
export type PrintingDeviceListScope = 'existing' | 'removed';
export type PrintingDeviceOperationStatus = 'PENDING' | 'RETRYABLE' | 'UNKNOWN';

export type PendingDeviceOperation = Readonly<{
  operation: PrintingDeviceOperation;
  resourceId?: string;
  idempotencyKey: string;
  expectedRevision?: number;
  status: PrintingDeviceOperationStatus;
  wasUncertain?: true;
}>;

export type PersistedPendingDeviceOperation = Readonly<{
  operation: PrintingDeviceOperation;
  resourceId?: string;
  idempotencyKey: string;
  expectedRevision?: number;
}>;

export type PrintingDevicesDialog = Readonly<{
  kind: 'bind' | 'verify' | 'recovery' | 'rename' | 'detail' | null;
  resourceId?: string;
  recoveryAction?:
    | 'resend'
    | 'requery'
    | 'delete-confirm'
    | 'unbind'
    | 'set-current'
    | 'clear-current';
}>;

export type PrintingDevicesForms = Readonly<{
  bind: BindCloudPrinterRequest;
  verify: ConfirmCloudPrinterRequest;
  recoveryPassword: string;
  rename: RenameCloudPrinterRequest;
}>;

export type PrintingDevicesState = Readonly<{
  devices: readonly CloudPrinterView[];
  current: CurrentCloudPrinterView;
  detail: CloudPrinterView | null;
  listScope: PrintingDeviceListScope;
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
