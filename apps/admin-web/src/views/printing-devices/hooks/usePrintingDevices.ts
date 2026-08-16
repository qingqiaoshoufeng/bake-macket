import {
  ApiErrorCode,
  CloudPrinterStatus,
  normalizeCloudPrinterDisplayName,
  normalizeCloudPrinterSerialNumber,
  type BindCloudPrinterResult,
  type ClearCurrentCloudPrinterResult,
  type CloudPrinterListQuery,
  type CloudPrinterView,
  type ConfirmCloudPrinterCompensationDeletionResult,
  type ConfirmCloudPrinterResult,
  type CurrentCloudPrinterView,
  type SetCurrentCloudPrinterResult,
  type PrinterVerificationChallengeView,
  type RefreshCloudPrinterOnlineStatusResult,
  type RenameCloudPrinterResult,
  type RequeryCloudPrinterVendorRelationResult,
  type ResendCloudPrinterVerificationResult,
  type UnbindCloudPrinterResult,
} from '@bake-mall/contracts';
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue';

import { ApiClientError } from '../../../api/http.js';
import { PENDING_DEVICE_OPERATIONS_STORAGE_KEY } from '../../../config/session-storage.js';
import { hasOwn } from '../../../utils/object.js';
import { createSecureUuidV4 } from '../../../utils/random-uuid.js';
import { printingDevicesApi } from '../api/index.js';
import {
  createBindPrinterDefaults,
  createRecoveryPrinterDefaults,
  createRenamePrinterDefaults,
  createVerifyPrinterDefaults,
  PRINTER_PAGINATION,
} from '../config/defaults.js';
import type {
  BindPrinterForm,
  PendingDeviceOperation,
  PersistedPendingDeviceOperation,
  PrintingDeviceError,
  PrintingDeviceOperation,
  PrintingDeviceListScope,
  PrinterChallengeState,
  RecoveryPrinterForm,
  RenamePrinterForm,
  VerifyPrinterForm,
} from '../type/index.js';

export { PENDING_DEVICE_OPERATIONS_STORAGE_KEY };

const CANONICAL_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_ADMIN_ID = /^[1-9]\d*$/u;
const OPERATIONS = new Set<PrintingDeviceOperation>([
  'bind',
  'confirm',
  'resend',
  'refresh',
  'requery',
  'delete-confirm',
  'unbind',
  'rename',
  'set-current',
  'clear-current',
]);
const UNKNOWN_CODES = new Set<ApiErrorCode>([
  ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
  ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
]);
type DialogState = {
  readonly kind: 'bind' | 'verify' | 'recovery' | 'rename' | 'detail' | null;
  readonly resourceId?: string;
  readonly recoveryAction?:
    | 'resend'
    | 'requery'
    | 'delete-confirm'
    | 'unbind'
    | 'set-current'
    | 'clear-current';
};

type PersistedOperations = {
  readonly adminId: string;
  readonly pendingDeviceOperations: readonly PersistedPendingDeviceOperation[];
};

type OperationRequest =
  | { readonly operation: 'bind'; readonly body: BindPrinterForm }
  | {
      readonly operation: 'confirm';
      readonly resourceId: string;
      readonly body: VerifyPrinterForm;
    }
  | {
      readonly operation: 'resend' | 'requery' | 'delete-confirm' | 'unbind';
      readonly resourceId: string;
      readonly body: RecoveryPrinterForm;
    }
  | { readonly operation: 'refresh'; readonly resourceId: string }
  | {
      readonly operation: 'rename';
      readonly resourceId: string;
      readonly body: RenamePrinterForm;
    }
  | {
      readonly operation: 'set-current';
      readonly resourceId: string;
      readonly body: { expectedRevision: number; operationPassword: string };
    }
  | {
      readonly operation: 'clear-current';
      readonly resourceId: string;
      readonly body: { expectedRevision: number; operationPassword: string };
    };

type OperationResult =
  | BindCloudPrinterResult
  | ConfirmCloudPrinterResult
  | ResendCloudPrinterVerificationResult
  | RefreshCloudPrinterOnlineStatusResult
  | RequeryCloudPrinterVendorRelationResult
  | ConfirmCloudPrinterCompensationDeletionResult
  | UnbindCloudPrinterResult
  | RenameCloudPrinterResult
  | SetCurrentCloudPrinterResult
  | ClearCurrentCloudPrinterResult;

export type UsePrintingDevicesOptions = {
  readonly adminId: Ref<string | null>;
  readonly now?: () => number;
};

export type UsePrintingDevicesResult = {
  readonly devices: Ref<readonly CloudPrinterView[]>;
  readonly current: Ref<CurrentCloudPrinterView>;
  readonly detail: Ref<CloudPrinterView | null>;
  readonly listScope: Ref<PrintingDeviceListScope>;
  readonly total: Ref<number>;
  readonly page: Ref<number>;
  readonly pageSize: Ref<number>;
  readonly loading: Ref<boolean>;
  readonly submitting: Ref<boolean>;
  readonly error: Ref<PrintingDeviceError | null>;
  readonly dialog: Ref<DialogState>;
  readonly bindForm: Ref<BindPrinterForm>;
  readonly verifyForm: Ref<VerifyPrinterForm>;
  readonly recoveryForm: Ref<RecoveryPrinterForm>;
  readonly renameForm: Ref<RenamePrinterForm>;
  readonly challenge: Ref<PrinterVerificationChallengeView | null>;
  readonly challengeByPrinterId: Ref<
    Readonly<Record<string, PrinterVerificationChallengeView>>
  >;
  readonly challengeState: ComputedRef<PrinterChallengeState>;
  readonly countdownSeconds: Ref<number>;
  readonly remainingAttempts: ComputedRef<number>;
  readonly challengeExpired: ComputedRef<boolean>;
  readonly pendingOperations: Ref<readonly PendingDeviceOperation[]>;
  readonly pendingResourceIds: ComputedRef<readonly string[]>;
  readonly load: () => Promise<void>;
  readonly setPage: (page: number) => Promise<void>;
  readonly setPageSize: (pageSize: number) => Promise<void>;
  readonly setListScope: (scope: PrintingDeviceListScope) => Promise<void>;
  readonly openDetail: (printerId: string) => Promise<void>;
  readonly setCurrent: (printerId: string) => Promise<SetCurrentCloudPrinterResult>;
  readonly clearCurrent: () => Promise<ClearCurrentCloudPrinterResult>;
  readonly bind: () => Promise<BindCloudPrinterResult>;
  readonly confirm: (printerId: string) => Promise<ConfirmCloudPrinterResult>;
  readonly resend: (
    printerId: string,
  ) => Promise<ResendCloudPrinterVerificationResult>;
  readonly refreshOnlineStatus: (
    printerId: string,
  ) => Promise<RefreshCloudPrinterOnlineStatusResult>;
  readonly requery: (
    printerId: string,
  ) => Promise<RequeryCloudPrinterVendorRelationResult>;
  readonly confirmDeletion: (
    printerId: string,
  ) => Promise<ConfirmCloudPrinterCompensationDeletionResult>;
  readonly unbind: (printerId: string) => Promise<UnbindCloudPrinterResult>;
  readonly rename: (printerId: string) => Promise<RenameCloudPrinterResult>;
  readonly retryOperation: (
    operation: PrintingDeviceOperation,
    resourceId?: string,
  ) => Promise<OperationResult>;
  readonly discardPendingOperation: (
    operation: PrintingDeviceOperation,
    resourceId?: string,
  ) => void;
  readonly updateCountdown: (nowMs?: number) => void;
  readonly openBind: () => void;
  readonly openVerify: (printer: CloudPrinterView) => void;
  readonly openRecovery: (
    action:
      | 'resend'
      | 'requery'
      | 'delete-confirm'
      | 'unbind'
      | 'set-current'
      | 'clear-current',
    printer: CloudPrinterView,
  ) => void;
  readonly openRename: (printer: CloudPrinterView) => void;
  readonly closeDialog: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => hasOwn(value, key))
  );
}

function isPersistedOperation(
  value: unknown,
): value is PersistedPendingDeviceOperation {
  if (!isRecord(value)) return false;
  const operation = value.operation;
  const hasResourceId = hasOwn(value, 'resourceId');
  const hasExpectedRevision = hasOwn(value, 'expectedRevision');
  const expectedKeys = [
    'operation',
    ...(hasResourceId ? ['resourceId'] : []),
    'idempotencyKey',
    ...(hasExpectedRevision ? ['expectedRevision'] : []),
  ];
  if (
    !hasExactKeys(value, expectedKeys) ||
    typeof operation !== 'string' ||
    !OPERATIONS.has(operation as PrintingDeviceOperation) ||
    typeof value.idempotencyKey !== 'string' ||
    !CANONICAL_UUID_V4.test(value.idempotencyKey)
  ) {
    return false;
  }
  if (
    hasExpectedRevision &&
    (!Number.isSafeInteger(value.expectedRevision) ||
      (value.expectedRevision as number) < 0)
  ) {
    return false;
  }
  if (operation === 'bind') return !hasResourceId && !hasExpectedRevision;
  if (
    (operation === 'set-current' || operation === 'clear-current') === false &&
    hasExpectedRevision
  ) {
    return false;
  }
  return (
    hasResourceId &&
    typeof value.resourceId === 'string' &&
    value.resourceId.length > 0
  );
}

function parsePersistedOperations(
  raw: string,
  adminId: string,
): readonly PendingDeviceOperation[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, ['adminId', 'pendingDeviceOperations']) ||
      parsed.adminId !== adminId ||
      !Array.isArray(parsed.pendingDeviceOperations) ||
      !parsed.pendingDeviceOperations.every(isPersistedOperation)
    ) {
      return null;
    }
    return parsed.pendingDeviceOperations.map((operation) => ({
      ...operation,
      status: 'UNKNOWN' as const,
      wasUncertain: true as const,
    }));
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    const parsed: unknown = JSON.parse(atob(padded));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function adminIdFromAccessToken(token: string | null): string | null {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  return payload?.aud === 'mall-admin' &&
    typeof payload.sub === 'string' &&
    CANONICAL_ADMIN_ID.test(payload.sub)
    ? payload.sub
    : null;
}

function operationIdentity(
  operation: PrintingDeviceOperation,
  resourceId?: string,
): string {
  return `${operation}:${resourceId ?? ''}`;
}

function apiErrorCode(error: unknown): ApiErrorCode | undefined {
  return error instanceof ApiClientError ? error.code : undefined;
}

function classifiedError(error: unknown): PrintingDeviceError {
  const code = apiErrorCode(error);
  if (code && UNKNOWN_CODES.has(code)) {
    return {
      kind: 'unknown',
      message: '操作结果尚未确定，请使用原操作继续确认',
    };
  }
  if (
    error instanceof ApiClientError &&
    (error.status === 0 || (error.status >= 500 && !error.code))
  ) {
    return {
      kind: 'retryable',
      message: '网络或服务响应异常，可使用原操作安全重试',
    };
  }
  return {
    kind: 'stable',
    message:
      error instanceof ApiClientError || error instanceof Error
        ? error.message
        : '操作失败，请检查设备状态后重试',
  };
}

type OperationErrorClassification = 'UNKNOWN' | 'RETRYABLE' | 'FAILED';

function classifyOperationError(error: unknown): OperationErrorClassification {
  const code = apiErrorCode(error);
  if (code && UNKNOWN_CODES.has(code)) return 'UNKNOWN';
  if (
    error instanceof ApiClientError &&
    (error.status === 0 || (error.status >= 500 && !error.code))
  ) {
    return 'RETRYABLE';
  }
  return 'FAILED';
}

function operationStatus(
  error: unknown,
): PendingDeviceOperation['status'] | null {
  const classification = classifyOperationError(error);
  if (classification === 'UNKNOWN') return 'UNKNOWN';
  if (classification === 'RETRYABLE') return 'RETRYABLE';
  return null;
}

function challengeCountdownSeconds(
  challenge: PrinterVerificationChallengeView | null,
  nowMs: number,
): number {
  if (!challenge) return 0;
  const expiresAt = Date.parse(challenge.expiresAt);
  return Number.isFinite(expiresAt)
    ? Math.max(0, Math.ceil((expiresAt - nowMs) / 1000))
    : 0;
}

function listQuery(
  scope: PrintingDeviceListScope,
  page: number,
  pageSize: number,
): CloudPrinterListQuery {
  const pagination = { page, pageSize };
  return scope === 'removed'
    ? {
        ...pagination,
        includeUnbound: true,
        status: CloudPrinterStatus.UNBOUND,
      }
    : { ...pagination, includeUnbound: false };
}

function currentPrinterView(
  current: CurrentCloudPrinterView,
): CurrentCloudPrinterView {
  return {
    ...current,
    printer: current.printer ? { ...current.printer, isCurrent: true } : null,
  };
}

function markCurrentDevice(
  device: CloudPrinterView,
  currentPrinterId: string | undefined,
): CloudPrinterView {
  return { ...device, isCurrent: currentPrinterId === device.id };
}

export function usePrintingDevices(
  options: UsePrintingDevicesOptions,
): UsePrintingDevicesResult {
  const now = options.now ?? Date.now;
  const devices = ref<readonly CloudPrinterView[]>([]);
  const current = ref<CurrentCloudPrinterView>({
    printer: null,
    revision: 0,
    updatedAt: '',
  });
  const detail = ref<CloudPrinterView | null>(null);
  const listScope = ref<PrintingDeviceListScope>('existing');
  const total = ref(0);
  const page = ref(PRINTER_PAGINATION.defaultPage);
  const pageSize = ref(PRINTER_PAGINATION.defaultPageSize);
  const loading = ref(false);
  const submitting = ref(false);
  const error = ref<PrintingDeviceError | null>(null);
  const dialog = ref<DialogState>({ kind: null });
  const bindForm = ref<BindPrinterForm>(createBindPrinterDefaults());
  const verifyForm = ref<VerifyPrinterForm>(createVerifyPrinterDefaults());
  const recoveryForm = ref<RecoveryPrinterForm>(
    createRecoveryPrinterDefaults(),
  );
  const renameForm = ref<RenamePrinterForm>(createRenamePrinterDefaults());
  const challenge = ref<PrinterVerificationChallengeView | null>(null);
  const challengeByPrinterId = ref<
    Readonly<Record<string, PrinterVerificationChallengeView>>
  >({});
  const countdownSeconds = ref(0);
  const pendingOperations = ref<readonly PendingDeviceOperation[]>([]);
  const operationRequests = new Map<string, OperationRequest>();
  const remainingAttempts = computed(
    () => challenge.value?.remainingAttempts ?? 0,
  );
  const challengeExpired = computed(
    () => challenge.value !== null && countdownSeconds.value === 0,
  );
  const challengeState = computed<PrinterChallengeState>(() => {
    if (!challenge.value) return 'metadata-missing';
    return countdownSeconds.value === 0 ? 'expired' : 'available';
  });
  const pendingResourceIds = computed(() =>
    pendingOperations.value.flatMap((operation) =>
      operation.resourceId ? [operation.resourceId] : [],
    ),
  );
  let listSequence = 0;
  let mutationGeneration = 0;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  function removePersistedOperations(): void {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(PENDING_DEVICE_OPERATIONS_STORAGE_KEY);
    }
  }

  function persistOperations(): void {
    if (typeof window === 'undefined') return;
    const adminId = options.adminId.value;
    if (!adminId || pendingOperations.value.length === 0) {
      removePersistedOperations();
      return;
    }
    const persisted: PersistedOperations = {
      adminId,
      pendingDeviceOperations: pendingOperations.value.map(
        ({ operation, resourceId, idempotencyKey, expectedRevision }) => ({
          operation,
          ...(resourceId ? { resourceId } : {}),
          idempotencyKey,
          ...(expectedRevision !== undefined ? { expectedRevision } : {}),
        }),
      ),
    };
    window.sessionStorage.setItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
      JSON.stringify(persisted),
    );
  }

  function clearOperations(): void {
    pendingOperations.value = [];
    operationRequests.clear();
    removePersistedOperations();
  }

  function hydrateOperations(adminId: string | null): void {
    if (typeof window === 'undefined' || !adminId) {
      clearOperations();
      return;
    }
    const raw = window.sessionStorage.getItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
    );
    if (!raw) return;
    const parsed = parsePersistedOperations(raw, adminId);
    if (!parsed) {
      clearOperations();
      return;
    }
    pendingOperations.value = parsed;
    if (parsed.length > 0) {
      error.value = {
        kind: 'unknown',
        message: '检测到未确认的打印机操作，请继续原操作或刷新权威状态',
      };
    }
  }

  hydrateOperations(options.adminId.value);
  watch(options.adminId, (nextAdminId, previousAdminId) => {
    if (nextAdminId !== previousAdminId) clearOperations();
  });

  function updatePending(
    next: PendingDeviceOperation,
    request?: OperationRequest,
  ): void {
    const identity = operationIdentity(next.operation, next.resourceId);
    pendingOperations.value = [
      ...pendingOperations.value.filter(
        (candidate) =>
          operationIdentity(candidate.operation, candidate.resourceId) !==
          identity,
      ),
      next,
    ];
    if (request) operationRequests.set(identity, request);
    persistOperations();
  }

  function releasePending(
    operation: PrintingDeviceOperation,
    resourceId: string | undefined,
    idempotencyKey: string,
  ): void {
    const identity = operationIdentity(operation, resourceId);
    const current = pendingOperations.value.find(
      (candidate) =>
        operationIdentity(candidate.operation, candidate.resourceId) ===
        identity,
    );
    if (current?.idempotencyKey !== idempotencyKey) return;
    pendingOperations.value = pendingOperations.value.filter(
      (candidate) =>
        operationIdentity(candidate.operation, candidate.resourceId) !==
        identity,
    );
    operationRequests.delete(identity);
    persistOperations();
  }

  function setPendingStatus(
    operation: PrintingDeviceOperation,
    resourceId: string | undefined,
    idempotencyKey: string,
    status: PendingDeviceOperation['status'],
  ): void {
    const identity = operationIdentity(operation, resourceId);
    pendingOperations.value = pendingOperations.value.map((candidate) =>
      operationIdentity(candidate.operation, candidate.resourceId) ===
        identity && candidate.idempotencyKey === idempotencyKey
        ? {
            ...candidate,
            status,
            ...((candidate.wasUncertain ||
              status === 'UNKNOWN' ||
              status === 'RETRYABLE') && { wasUncertain: true as const }),
          }
        : candidate,
    );
    persistOperations();
  }

  function updateChallengeMetadata(
    printers: readonly CloudPrinterView[],
  ): void {
    challengeByPrinterId.value = printers.reduce<
      Readonly<Record<string, PrinterVerificationChallengeView>>
    >(
      (metadata, printer) =>
        printer.challenge
          ? { ...metadata, [printer.id]: { ...printer.challenge } }
          : metadata,
      {},
    );
    const selectedPrinterId = dialog.value.resourceId;
    if (dialog.value.kind === 'verify' && selectedPrinterId) {
      challenge.value = challengeByPrinterId.value[selectedPrinterId] ?? null;
      updateCountdown();
    }
  }

  function upsertDevice(printer: CloudPrinterView): void {
    const exists = devices.value.some((device) => device.id === printer.id);
    devices.value = exists
      ? devices.value.map((device) =>
          device.id === printer.id ? { ...printer } : device,
        )
      : [{ ...printer }, ...devices.value];
    challengeByPrinterId.value = printer.challenge
      ? {
          ...challengeByPrinterId.value,
          [printer.id]: { ...printer.challenge },
        }
      : Object.fromEntries(
          Object.entries(challengeByPrinterId.value).filter(
            ([printerId]) => printerId !== printer.id,
          ),
        );
  }

  function updateCountdown(nowMs = now()): void {
    countdownSeconds.value = challengeCountdownSeconds(challenge.value, nowMs);
  }

  function startCountdown(): void {
    if (countdownTimer) clearInterval(countdownTimer);
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 1000);
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (countdownTimer) clearInterval(countdownTimer);
    });
  }

  async function load(
    options: { readonly preserveError?: boolean } = {},
  ): Promise<void> {
    const sequence = listSequence + 1;
    const generation = mutationGeneration;
    listSequence = sequence;
    loading.value = true;
    if (!options.preserveError && pendingOperations.value.length === 0) {
      error.value = null;
    }
    try {
      const [result, authoritativeCurrent] = await Promise.all([
        printingDevicesApi.list(
          listQuery(listScope.value, page.value, pageSize.value),
        ),
        printingDevicesApi.current(),
      ]);
      if (sequence !== listSequence || generation !== mutationGeneration)
        return;
      current.value = currentPrinterView(authoritativeCurrent);
      devices.value = result.items.map((device) =>
        markCurrentDevice(device, authoritativeCurrent.printer?.id),
      );
      updateChallengeMetadata(devices.value);
      total.value = result.total;
      page.value = result.page;
      pageSize.value = result.pageSize;
    } catch (caught) {
      if (sequence === listSequence && !options.preserveError) {
        error.value = classifiedError(caught);
      }
      throw caught;
    } finally {
      if (sequence === listSequence) loading.value = false;
    }
  }

  async function setPage(nextPage: number): Promise<void> {
    page.value = nextPage;
    await load();
  }

  async function setPageSize(nextPageSize: number): Promise<void> {
    pageSize.value = nextPageSize;
    page.value = PRINTER_PAGINATION.defaultPage;
    await load();
  }

  async function setListScope(scope: PrintingDeviceListScope): Promise<void> {
    listScope.value = scope;
    page.value = PRINTER_PAGINATION.defaultPage;
    await load();
  }

  async function openDetail(printerId: string): Promise<void> {
    detail.value = { ...(await printingDevicesApi.detail(printerId)) };
    dialog.value = { kind: 'detail', resourceId: printerId };
  }

  function applyResult(
    operation: PrintingDeviceOperation,
    result: OperationResult,
    idempotencyKey: string,
    resourceId?: string,
  ): void {
    const pending = pendingOperations.value.find(
      (candidate) =>
        operationIdentity(candidate.operation, candidate.resourceId) ===
        operationIdentity(operation, resourceId),
    );
    if (pending?.idempotencyKey !== idempotencyKey) return;
    if ('current' in result) {
      current.value = currentPrinterView(result.current);
      devices.value = devices.value.map((device) =>
        markCurrentDevice(device, result.current.printer?.id),
      );
      dialog.value = { kind: null };
      return;
    }
    upsertDevice(result.printer);
    if ('challenge' in result) {
      challenge.value = { ...result.challenge };
      challengeByPrinterId.value = {
        ...challengeByPrinterId.value,
        [result.printer.id]: { ...result.challenge },
      };
      verifyForm.value = createVerifyPrinterDefaults(
        result.challenge.challengeId,
      );
      dialog.value = { kind: 'verify', resourceId: result.printer.id };
      startCountdown();
    } else if (operation === 'confirm') {
      challenge.value = null;
      countdownSeconds.value = 0;
      dialog.value = { kind: null };
    } else if (operation !== 'refresh') {
      dialog.value = { kind: null };
    }
  }

  async function callOperation(
    request: OperationRequest,
    idempotencyKey: string,
  ): Promise<OperationResult> {
    switch (request.operation) {
      case 'bind':
        return printingDevicesApi.bind(request.body, idempotencyKey);
      case 'confirm':
        return printingDevicesApi.confirm(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'resend':
        return printingDevicesApi.resend(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'refresh':
        return printingDevicesApi.refresh(
          request.resourceId,
          {},
          idempotencyKey,
        );
      case 'requery':
        return printingDevicesApi.requery(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'delete-confirm':
        return printingDevicesApi.confirmDeletion(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'unbind':
        return printingDevicesApi.unbind(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'rename':
        return printingDevicesApi.rename(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'set-current':
        return printingDevicesApi.setCurrent(
          { printerId: request.resourceId, ...request.body },
          idempotencyKey,
        );
      case 'clear-current':
        return printingDevicesApi.clearCurrent(request.body, idempotencyKey);
    }
  }

  async function reloadAfterMutation(preserveError = false): Promise<void> {
    mutationGeneration += 1;
    try {
      await load({ preserveError });
    } catch {
      if (preserveError && dialog.value.kind === 'verify') {
        challenge.value = null;
        countdownSeconds.value = 0;
      }
    }
  }

  async function execute(
    request: OperationRequest,
    idempotencyKey: string,
  ): Promise<OperationResult> {
    const resourceId = 'resourceId' in request ? request.resourceId : undefined;
    submitting.value = true;
    error.value = null;
    setPendingStatus(request.operation, resourceId, idempotencyKey, 'PENDING');
    try {
      const result = await callOperation(request, idempotencyKey);
      applyResult(request.operation, result, idempotencyKey, resourceId);
      releasePending(request.operation, resourceId, idempotencyKey);
      await reloadAfterMutation();
      return result;
    } catch (caught) {
      const current = pendingOperations.value.find(
        (candidate) =>
          operationIdentity(candidate.operation, candidate.resourceId) ===
            operationIdentity(request.operation, resourceId) &&
          candidate.idempotencyKey === idempotencyKey,
      );
      if (!current) throw caught;
      const status = operationStatus(caught);
      if (status) {
        setPendingStatus(request.operation, resourceId, idempotencyKey, status);
      } else {
        releasePending(request.operation, resourceId, idempotencyKey);
      }
      error.value = classifiedError(caught);
      if (!status) await reloadAfterMutation(true);
      throw caught;
    } finally {
      submitting.value = pendingOperations.value.some(
        (operation) => operation.status === 'PENDING',
      );
    }
  }

  function begin(request: OperationRequest): Promise<OperationResult> {
    const idempotencyKey = createSecureUuidV4();
    const resourceId = 'resourceId' in request ? request.resourceId : undefined;
    updatePending(
      {
        operation: request.operation,
        ...(resourceId ? { resourceId } : {}),
        idempotencyKey,
        ...((request.operation === 'set-current' ||
          request.operation === 'clear-current') && {
          expectedRevision: request.body.expectedRevision,
        }),
        status: 'PENDING',
      },
      request,
    );
    return execute(request, idempotencyKey);
  }

  function requestForRetry(
    operation: PrintingDeviceOperation,
    resourceId: string | undefined,
    pending: PendingDeviceOperation,
  ): OperationRequest {
    const remembered = operationRequests.get(
      operationIdentity(operation, resourceId),
    );
    if (remembered) return remembered;
    if (operation === 'bind') {
      return { operation, body: { ...bindForm.value } };
    }
    if (!resourceId) throw new Error('缺少打印机 ID，无法继续操作');
    if (operation === 'confirm') {
      return { operation, resourceId, body: { ...verifyForm.value } };
    }
    if (
      operation === 'resend' ||
      operation === 'requery' ||
      operation === 'delete-confirm' ||
      operation === 'unbind'
    ) {
      return { operation, resourceId, body: { ...recoveryForm.value } };
    }
    if (operation === 'rename') {
      return { operation, resourceId, body: { ...renameForm.value } };
    }
    if (operation === 'set-current' || operation === 'clear-current') {
      if (pending.expectedRevision === undefined) {
        throw new Error(
          '该待恢复操作缺少原始版本，无法安全重试；请刷新权威状态后清除记录',
        );
      }
      return {
        operation,
        resourceId,
        body: {
          expectedRevision: pending.expectedRevision,
          operationPassword: recoveryForm.value.operationPassword,
        },
      };
    }
    return { operation: 'refresh', resourceId };
  }

  function clearRetriedSensitiveForm(request: OperationRequest): void {
    if (request.operation === 'bind') {
      bindForm.value = {
        serialNumber: '',
        displayName: request.body.displayName,
        operationPassword: '',
      };
    } else if (request.operation === 'confirm') {
      verifyForm.value = createVerifyPrinterDefaults(request.body.challengeId);
    } else if (
      request.operation === 'resend' ||
      request.operation === 'requery' ||
      request.operation === 'delete-confirm' ||
      request.operation === 'unbind' ||
      request.operation === 'set-current' ||
      request.operation === 'clear-current'
    ) {
      recoveryForm.value = createRecoveryPrinterDefaults();
    }
  }

  async function retryOperation(
    operation: PrintingDeviceOperation,
    resourceId?: string,
  ): Promise<OperationResult> {
    const pending = pendingOperations.value.find(
      (candidate) =>
        operationIdentity(candidate.operation, candidate.resourceId) ===
        operationIdentity(operation, resourceId),
    );
    if (!pending) throw new Error('没有可继续的打印机操作');
    let request: OperationRequest;
    try {
      request = requestForRetry(operation, resourceId, pending);
    } catch (caught) {
      error.value = classifiedError(caught);
      throw caught;
    }
    clearRetriedSensitiveForm(request);
    operationRequests.set(operationIdentity(operation, resourceId), request);
    return execute(request, pending.idempotencyKey);
  }

  function discardPendingOperation(
    operation: PrintingDeviceOperation,
    resourceId?: string,
  ): void {
    const pending = pendingOperations.value.find(
      (candidate) =>
        operationIdentity(candidate.operation, candidate.resourceId) ===
        operationIdentity(operation, resourceId),
    );
    if (!pending) return;
    releasePending(operation, resourceId, pending.idempotencyKey);
  }

  async function bind(): Promise<BindCloudPrinterResult> {
    const serialNumber = normalizeCloudPrinterSerialNumber(
      bindForm.value.serialNumber,
    );
    if (!serialNumber) throw new Error('设备序列号格式不正确');
    const displayName = normalizeCloudPrinterDisplayName(
      bindForm.value.displayName,
    );
    if (!displayName) throw new Error('打印机名称需为 1–64 个字符');
    if (!bindForm.value.operationPassword) throw new Error('请输入操作密码');
    const request = { ...bindForm.value, serialNumber, displayName };
    bindForm.value = {
      serialNumber: '',
      displayName: request.displayName,
      operationPassword: '',
    };
    return begin({
      operation: 'bind',
      body: request,
    }) as Promise<BindCloudPrinterResult>;
  }

  async function confirm(
    printerId: string,
  ): Promise<ConfirmCloudPrinterResult> {
    const request = { ...verifyForm.value };
    if (!/^\d{6}$/u.test(request.code)) {
      throw new Error('验证码必须为 6 位数字');
    }
    if (!request.operationPassword) throw new Error('请输入操作密码');
    verifyForm.value = createVerifyPrinterDefaults(request.challengeId);
    return begin({
      operation: 'confirm',
      resourceId: printerId,
      body: request,
    }) as Promise<ConfirmCloudPrinterResult>;
  }

  async function resend(
    printerId: string,
  ): Promise<ResendCloudPrinterVerificationResult> {
    const request = { ...recoveryForm.value };
    recoveryForm.value = createRecoveryPrinterDefaults();
    return begin({
      operation: 'resend',
      resourceId: printerId,
      body: request,
    }) as Promise<ResendCloudPrinterVerificationResult>;
  }

  async function refreshOnlineStatus(
    printerId: string,
  ): Promise<RefreshCloudPrinterOnlineStatusResult> {
    return begin({
      operation: 'refresh',
      resourceId: printerId,
    }) as Promise<RefreshCloudPrinterOnlineStatusResult>;
  }

  async function requery(
    printerId: string,
  ): Promise<RequeryCloudPrinterVendorRelationResult> {
    const request = { ...recoveryForm.value };
    recoveryForm.value = createRecoveryPrinterDefaults();
    return begin({
      operation: 'requery',
      resourceId: printerId,
      body: request,
    }) as Promise<RequeryCloudPrinterVendorRelationResult>;
  }

  async function confirmDeletion(
    printerId: string,
  ): Promise<ConfirmCloudPrinterCompensationDeletionResult> {
    const request = { ...recoveryForm.value };
    recoveryForm.value = createRecoveryPrinterDefaults();
    return begin({
      operation: 'delete-confirm',
      resourceId: printerId,
      body: request,
    }) as Promise<ConfirmCloudPrinterCompensationDeletionResult>;
  }

  async function unbind(
    printerId: string,
  ): Promise<UnbindCloudPrinterResult> {
    const request = { ...recoveryForm.value };
    recoveryForm.value = createRecoveryPrinterDefaults();
    return begin({
      operation: 'unbind',
      resourceId: printerId,
      body: request,
    }) as Promise<UnbindCloudPrinterResult>;
  }

  function beginCurrentOperation(
    operation: 'set-current' | 'clear-current',
    printerId?: string,
  ): Promise<SetCurrentCloudPrinterResult | ClearCurrentCloudPrinterResult> {
    const operationPassword = recoveryForm.value.operationPassword;
    if (!operationPassword) throw new Error('请输入操作密码');
    recoveryForm.value = createRecoveryPrinterDefaults();
    if (!printerId) throw new Error('当前没有可清除的打印机');
    return begin({
      operation,
      resourceId: printerId,
      body: { expectedRevision: current.value.revision, operationPassword },
    }) as Promise<SetCurrentCloudPrinterResult | ClearCurrentCloudPrinterResult>;
  }

  async function setCurrent(
    printerId: string,
  ): Promise<SetCurrentCloudPrinterResult> {
    return beginCurrentOperation(
      'set-current',
      printerId,
    ) as Promise<SetCurrentCloudPrinterResult>;
  }

  async function clearCurrent(): Promise<ClearCurrentCloudPrinterResult> {
    return beginCurrentOperation(
      'clear-current',
      current.value.printer?.id,
    ) as Promise<ClearCurrentCloudPrinterResult>;
  }

  async function rename(printerId: string): Promise<RenameCloudPrinterResult> {
    const normalized = normalizeCloudPrinterDisplayName(
      renameForm.value.displayName,
    );
    if (normalized === null) {
      const trimmedLength = Array.from(
        renameForm.value.displayName.trim(),
      ).length;
      throw new Error(
        trimmedLength === 0 ? '打印机名称不能为空' : '打印机名称最多 64 个字符',
      );
    }
    renameForm.value = createRenamePrinterDefaults(normalized);
    return begin({
      operation: 'rename',
      resourceId: printerId,
      body: { displayName: normalized },
    }) as Promise<RenameCloudPrinterResult>;
  }

  function openBind(): void {
    bindForm.value = createBindPrinterDefaults();
    dialog.value = { kind: 'bind' };
    error.value = null;
  }

  function openVerify(printer: CloudPrinterView): void {
    const printerChallenge =
      printer.challenge ?? challengeByPrinterId.value[printer.id] ?? null;
    challenge.value = printerChallenge ? { ...printerChallenge } : null;
    verifyForm.value = createVerifyPrinterDefaults(
      printerChallenge?.challengeId ?? printer.id,
    );
    dialog.value = { kind: 'verify', resourceId: printer.id };
    error.value = null;
    if (printerChallenge) startCountdown();
    else countdownSeconds.value = 0;
  }

  function openRecovery(
    action:
      | 'resend'
      | 'requery'
      | 'delete-confirm'
      | 'unbind'
      | 'set-current'
      | 'clear-current',
    printer: CloudPrinterView,
  ): void {
    recoveryForm.value = createRecoveryPrinterDefaults();
    dialog.value = {
      kind: 'recovery',
      resourceId: printer.id,
      recoveryAction: action,
    };
    error.value = null;
  }

  function openRename(printer: CloudPrinterView): void {
    renameForm.value = createRenamePrinterDefaults(printer.displayName);
    dialog.value = { kind: 'rename', resourceId: printer.id };
    error.value = null;
  }

  function closeDialog(): void {
    bindForm.value = createBindPrinterDefaults();
    verifyForm.value = createVerifyPrinterDefaults(
      verifyForm.value.challengeId,
    );
    recoveryForm.value = createRecoveryPrinterDefaults();
    renameForm.value = createRenamePrinterDefaults();
    dialog.value = { kind: null };
  }

  return {
    devices,
    current,
    detail,
    listScope,
    total,
    page,
    pageSize,
    loading,
    submitting,
    error,
    dialog,
    bindForm,
    verifyForm,
    recoveryForm,
    renameForm,
    challenge,
    challengeByPrinterId,
    challengeState,
    countdownSeconds,
    remainingAttempts,
    challengeExpired,
    pendingOperations,
    pendingResourceIds,
    load,
    setPage,
    setPageSize,
    setListScope,
    openDetail,
    setCurrent,
    clearCurrent,
    bind,
    confirm,
    resend,
    refreshOnlineStatus,
    requery,
    confirmDeletion,
    unbind,
    rename,
    retryOperation,
    discardPendingOperation,
    updateCountdown,
    openBind,
    openVerify,
    openRecovery,
    openRename,
    closeDialog,
  };
}
