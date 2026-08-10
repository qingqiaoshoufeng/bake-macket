import {
  ApiErrorCode,
  normalizeCloudPrinterDisplayName,
  type BindCloudPrinterResult,
  type CloudPrinterView,
  type ConfirmCloudPrinterCompensationDeletionResult,
  type ConfirmCloudPrinterResult,
  type PrinterVerificationChallengeView,
  type RefreshCloudPrinterOnlineStatusResult,
  type RenameCloudPrinterResult,
  type RequeryCloudPrinterVendorRelationResult,
  type ResendCloudPrinterVerificationResult,
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
  'rename',
]);
const UNKNOWN_CODES = new Set<ApiErrorCode>([
  ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
  ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
]);
const STABLE_CONFIRM_CODES = new Set<ApiErrorCode>([
  ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
  ApiErrorCode.CLOUD_PRINTER_VERIFICATION_EXPIRED,
  ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED,
]);

type DialogState = {
  readonly kind: 'bind' | 'verify' | 'recovery' | 'rename' | null;
  readonly resourceId?: string;
  readonly recoveryAction?: 'resend' | 'requery' | 'delete-confirm';
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
      readonly operation: 'resend' | 'requery' | 'delete-confirm';
      readonly resourceId: string;
      readonly body: RecoveryPrinterForm;
    }
  | { readonly operation: 'refresh'; readonly resourceId: string }
  | {
      readonly operation: 'rename';
      readonly resourceId: string;
      readonly body: RenamePrinterForm;
    };

type OperationResult =
  | BindCloudPrinterResult
  | ConfirmCloudPrinterResult
  | ResendCloudPrinterVerificationResult
  | RefreshCloudPrinterOnlineStatusResult
  | RequeryCloudPrinterVendorRelationResult
  | ConfirmCloudPrinterCompensationDeletionResult
  | RenameCloudPrinterResult;

export type UsePrintingDevicesOptions = {
  readonly adminId: Ref<string | null>;
  readonly now?: () => number;
};

export type UsePrintingDevicesResult = {
  readonly devices: Ref<readonly CloudPrinterView[]>;
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
  readonly rename: (printerId: string) => Promise<RenameCloudPrinterResult>;
  readonly retryOperation: (
    operation: PrintingDeviceOperation,
    resourceId?: string,
  ) => Promise<OperationResult>;
  readonly updateCountdown: (nowMs?: number) => void;
  readonly openBind: () => void;
  readonly openVerify: (printer: CloudPrinterView) => void;
  readonly openRecovery: (
    action: 'resend' | 'requery' | 'delete-confirm',
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
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isPersistedOperation(
  value: unknown,
): value is PersistedPendingDeviceOperation {
  if (!isRecord(value)) return false;
  const operation = value.operation;
  const hasResourceId = Object.hasOwn(value, 'resourceId');
  if (
    !hasExactKeys(
      value,
      hasResourceId
        ? ['operation', 'resourceId', 'idempotencyKey']
        : ['operation', 'idempotencyKey'],
    ) ||
    typeof operation !== 'string' ||
    !OPERATIONS.has(operation as PrintingDeviceOperation) ||
    typeof value.idempotencyKey !== 'string' ||
    !CANONICAL_UUID_V4.test(value.idempotencyKey)
  ) {
    return false;
  }
  if (operation === 'bind') return !hasResourceId;
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
      error instanceof ApiClientError
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

export function usePrintingDevices(
  options: UsePrintingDevicesOptions,
): UsePrintingDevicesResult {
  const now = options.now ?? Date.now;
  const devices = ref<readonly CloudPrinterView[]>([]);
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
        ({ operation, resourceId, idempotencyKey }) => ({
          operation,
          ...(resourceId ? { resourceId } : {}),
          idempotencyKey,
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
    if (!options.preserveError) error.value = null;
    try {
      const result = await printingDevicesApi.list({
        page: page.value,
        pageSize: pageSize.value,
      });
      if (sequence !== listSequence || generation !== mutationGeneration)
        return;
      devices.value = result.items.map((device) => ({ ...device }));
      updateChallengeMetadata(result.items);
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

  function applyResult(
    operation: PrintingDeviceOperation,
    result: OperationResult,
    idempotencyKey: string,
    resourceId?: string,
  ): void {
    const current = pendingOperations.value.find(
      (candidate) =>
        operationIdentity(candidate.operation, candidate.resourceId) ===
        operationIdentity(operation, resourceId),
    );
    if (current?.idempotencyKey !== idempotencyKey) return;
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
      case 'rename':
        return printingDevicesApi.rename(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
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
      const classification = classifyOperationError(caught);
      const status = operationStatus(caught);
      if (status) {
        setPendingStatus(request.operation, resourceId, idempotencyKey, status);
      } else {
        releasePending(request.operation, resourceId, idempotencyKey);
      }
      error.value = classifiedError(caught);
      if (
        request.operation === 'confirm' &&
        apiErrorCode(caught) !== undefined &&
        STABLE_CONFIRM_CODES.has(apiErrorCode(caught)!)
      ) {
        await reloadAfterMutation(true);
      } else if (classification === 'FAILED') {
        await reloadAfterMutation(true);
      }
      throw caught;
    } finally {
      submitting.value = pendingOperations.value.some(
        (operation) => operation.status === 'PENDING',
      );
    }
  }

  function begin(request: OperationRequest): Promise<OperationResult> {
    const idempotencyKey = crypto.randomUUID();
    const resourceId = 'resourceId' in request ? request.resourceId : undefined;
    updatePending(
      {
        operation: request.operation,
        ...(resourceId ? { resourceId } : {}),
        idempotencyKey,
        status: 'PENDING',
      },
      request,
    );
    return execute(request, idempotencyKey);
  }

  function requestForRetry(
    operation: PrintingDeviceOperation,
    resourceId?: string,
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
      operation === 'delete-confirm'
    ) {
      return { operation, resourceId, body: { ...recoveryForm.value } };
    }
    if (operation === 'rename') {
      return { operation, resourceId, body: { ...renameForm.value } };
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
      request.operation === 'delete-confirm'
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
    const request = requestForRetry(operation, resourceId);
    clearRetriedSensitiveForm(request);
    operationRequests.set(operationIdentity(operation, resourceId), request);
    return execute(request, pending.idempotencyKey);
  }

  async function bind(): Promise<BindCloudPrinterResult> {
    const request = { ...bindForm.value };
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
    action: 'resend' | 'requery' | 'delete-confirm',
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
    bind,
    confirm,
    resend,
    refreshOnlineStatus,
    requery,
    confirmDeletion,
    rename,
    retryOperation,
    updateCountdown,
    openBind,
    openVerify,
    openRecovery,
    openRename,
    closeDialog,
  };
}
