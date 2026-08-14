import type {
  AdminSessionView,
  BindCloudPrinterRequest,
  BindCloudPrinterResult,
  CloudPrinterListQuery,
  CloudPrinterListResult,
  CloudPrinterView,
  ConfirmCloudPrinterCompensationDeletionResult,
  ConfirmCloudPrinterResult,
  PrinterVerificationChallengeView,
  RefreshCloudPrinterOnlineStatusResult,
  RenameCloudPrinterResult,
  RequeryCloudPrinterVendorRelationResult,
  ResendCloudPrinterVerificationResult,
  UnbindCloudPrinterResult,
} from '@bake-mall/contracts';

import {
  AdminPermission,
  ApiErrorCode,
  CloudPrinterStatus,
  normalizeCloudPrinterDisplayName,
} from '../../config/contracts.generated.js';
import { ApiClientError } from '../../utils/api-client.js';
import type { MemorySessionStore } from '../../utils/admin-session.js';
import {
  createSecureUuidV4,
  isUuidV4,
  requireUuidV4,
  type RandomUuidFactory,
} from '../../utils/random-uuid.js';
import {
  PRINTING_DEVICE_PAGE_SIZE,
  actionsForPrinter,
} from '../config/printing-devices.js';
import type {
  PendingDeviceOperation,
  PersistedPendingDeviceOperation,
  PrintingDeviceOperation,
  PrintingDeviceOperationStatus,
  PrintingDevicesState,
} from '../type/printing-devices.js';

export const PRINTING_DEVICES_STORAGE_KEY = 'bake-mall:admin-printing-devices';
const ADMIN_ID_PATTERN = /^[1-9]\d*$/u;
const OPERATIONS = new Set<PrintingDeviceOperation>([
  'bind',
  'confirm',
  'resend',
  'refresh',
  'requery',
  'delete-confirm',
  'unbind',
  'rename',
]);
const UNCERTAIN_CODES = new Set<ApiErrorCode>([
  ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
  ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
]);
const AUTHORITATIVE_CONFIRM_CODES = new Set<ApiErrorCode>([
  ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
  ApiErrorCode.CLOUD_PRINTER_VERIFICATION_EXPIRED,
  ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED,
]);

export type PrintingDevicesStorage = Readonly<{
  get: (key: string) => unknown;
  remove: (key: string) => void;
  set: (key: string, value: unknown) => void;
}>;

export type PrintingDevicesApi = Readonly<{
  list: (query: CloudPrinterListQuery) => Promise<CloudPrinterListResult>;
  bind: (
    body: BindCloudPrinterRequest,
    idempotencyKey: string,
  ) => Promise<BindCloudPrinterResult>;
  confirm: (
    printerId: string,
    body: import('@bake-mall/contracts').ConfirmCloudPrinterRequest,
    idempotencyKey: string,
  ) => Promise<ConfirmCloudPrinterResult>;
  resend: (
    printerId: string,
    body: import('@bake-mall/contracts').ResendCloudPrinterVerificationRequest,
    idempotencyKey: string,
  ) => Promise<ResendCloudPrinterVerificationResult>;
  refresh: (
    printerId: string,
    body: import('@bake-mall/contracts').RefreshCloudPrinterOnlineStatusRequest,
    idempotencyKey: string,
  ) => Promise<RefreshCloudPrinterOnlineStatusResult>;
  requery: (
    printerId: string,
    body: import('@bake-mall/contracts').RequeryCloudPrinterVendorRelationRequest,
    idempotencyKey: string,
  ) => Promise<RequeryCloudPrinterVendorRelationResult>;
  confirmDeletion: (
    printerId: string,
    body: import('@bake-mall/contracts').ConfirmCloudPrinterCompensationDeletionRequest,
    idempotencyKey: string,
  ) => Promise<ConfirmCloudPrinterCompensationDeletionResult>;
  unbind: (
    printerId: string,
    body: import('@bake-mall/contracts').UnbindCloudPrinterRequest,
    idempotencyKey: string,
  ) => Promise<UnbindCloudPrinterResult>;
  rename: (
    printerId: string,
    body: import('@bake-mall/contracts').RenameCloudPrinterRequest,
    idempotencyKey: string,
  ) => Promise<RenameCloudPrinterResult>;
}>;

type OperationRequest =
  | {
      readonly operation: 'bind';
      readonly body: import('@bake-mall/contracts').BindCloudPrinterRequest;
    }
  | {
      readonly operation: 'confirm';
      readonly resourceId: string;
      readonly body: import('@bake-mall/contracts').ConfirmCloudPrinterRequest;
    }
  | {
      readonly operation: 'resend' | 'requery' | 'delete-confirm' | 'unbind';
      readonly resourceId: string;
      readonly body: import('@bake-mall/contracts').RequeryCloudPrinterVendorRelationRequest;
    }
  | { readonly operation: 'refresh'; readonly resourceId: string }
  | {
      readonly operation: 'rename';
      readonly resourceId: string;
      readonly body: import('@bake-mall/contracts').RenameCloudPrinterRequest;
    };

type OperationResult =
  | BindCloudPrinterResult
  | ConfirmCloudPrinterResult
  | ResendCloudPrinterVerificationResult
  | RefreshCloudPrinterOnlineStatusResult
  | RequeryCloudPrinterVendorRelationResult
  | ConfirmCloudPrinterCompensationDeletionResult
  | UnbindCloudPrinterResult
  | RenameCloudPrinterResult;

type PersistedState = Readonly<{
  adminId: string;
  lastPrinterId?: string;
  pendingDeviceOperations: readonly PersistedPendingDeviceOperation[];
}>;

type Dependencies = Readonly<{
  adminSession: MemorySessionStore<AdminSessionView>;
  api: PrintingDevicesApi;
  storage?: PrintingDevicesStorage;
  randomUUID?: RandomUuidFactory;
  now?: () => number;
}>;

function defaultStorage(): PrintingDevicesStorage {
  return {
    get: (key) => wx.getStorageSync(key),
    remove: (key) => wx.removeStorageSync(key),
    set: (key, value) => wx.setStorageSync(key, value),
  };
}

function emptyState(): PrintingDevicesState {
  return {
    devices: [],
    total: 0,
    page: 1,
    pageSize: PRINTING_DEVICE_PAGE_SIZE,
    loading: false,
    error: null,
    dialog: { kind: null },
    forms: {
      bind: { serialNumber: '', displayName: '', operationPassword: '' },
      verify: { challengeId: '', code: '', operationPassword: '' },
      recoveryPassword: '',
      rename: { displayName: '' },
    },
    challengeByPrinterId: {},
    countdownSeconds: 0,
    remainingAttempts: 0,
    operations: [],
    operationMap: {},
    mutationGeneration: 0,
    manualContinueRequired: false,
  };
}

function cloneState(state: PrintingDevicesState): PrintingDevicesState {
  return {
    ...state,
    devices: state.devices.map((device) => ({
      ...device,
      ...(device.challenge ? { challenge: { ...device.challenge } } : {}),
    })),
    dialog: { ...state.dialog },
    forms: {
      bind: { ...state.forms.bind },
      verify: { ...state.forms.verify },
      recoveryPassword: state.forms.recoveryPassword,
      rename: { ...state.forms.rename },
    },
    challengeByPrinterId: Object.fromEntries(
      Object.entries(state.challengeByPrinterId).map(([id, challenge]) => [
        id,
        { ...challenge },
      ]),
    ),
    operations: state.operations.map((operation) => ({ ...operation })),
    operationMap: { ...state.operationMap },
  };
}

function identity(
  operation: PrintingDeviceOperation,
  resourceId?: string,
): string {
  return `${operation}:${resourceId ?? ''}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isPersistedOperation(
  value: unknown,
): value is PersistedPendingDeviceOperation {
  if (!isRecord(value)) return false;
  const hasResourceId = Object.prototype.hasOwnProperty.call(
    value,
    'resourceId',
  );
  const operation = value.operation;
  if (
    !exactKeys(
      value,
      hasResourceId
        ? ['operation', 'resourceId', 'idempotencyKey']
        : ['operation', 'idempotencyKey'],
    ) ||
    typeof operation !== 'string' ||
    !OPERATIONS.has(operation as PrintingDeviceOperation) ||
    typeof value.idempotencyKey !== 'string' ||
    !isUuidV4(value.idempotencyKey)
  ) {
    return false;
  }
  return operation === 'bind'
    ? !hasResourceId
    : hasResourceId &&
        typeof value.resourceId === 'string' &&
        value.resourceId.length > 0;
}

function isPersistedState(
  value: unknown,
  adminId: string,
): value is PersistedState {
  if (!isRecord(value)) return false;
  const hasLastPrinterId = Object.prototype.hasOwnProperty.call(
    value,
    'lastPrinterId',
  );
  return (
    exactKeys(
      value,
      hasLastPrinterId
        ? ['adminId', 'lastPrinterId', 'pendingDeviceOperations']
        : ['adminId', 'pendingDeviceOperations'],
    ) &&
    value.adminId === adminId &&
    (!hasLastPrinterId ||
      (typeof value.lastPrinterId === 'string' &&
        value.lastPrinterId.length > 0)) &&
    Array.isArray(value.pendingDeviceOperations) &&
    value.pendingDeviceOperations.every(isPersistedOperation)
  );
}

function decodeBase64Url(value: string): string | null {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const normalized = value
    .replace(/-/gu, '+')
    .replace(/_/gu, '/')
    .replace(/=+$/gu, '');
  const indexes = Array.from(normalized).map((character) =>
    alphabet.indexOf(character),
  );
  if (indexes.some((index) => index < 0)) return null;
  const bits = indexes
    .map((index) => index.toString(2).padStart(6, '0'))
    .join('');
  const bytes =
    bits.match(/.{8}/gu)?.map((byte) => Number.parseInt(byte, 2)) ?? [];
  return String.fromCharCode(...bytes);
}

function adminIdFromSession(session: AdminSessionView | null): string | null {
  const payload = session?.accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = decodeBase64Url(payload);
    const parsed: unknown = decoded ? JSON.parse(decoded) : null;
    return isRecord(parsed) &&
      parsed.aud === 'mall-admin' &&
      typeof parsed.sub === 'string' &&
      ADMIN_ID_PATTERN.test(parsed.sub)
      ? parsed.sub
      : null;
  } catch {
    return null;
  }
}

function apiCode(error: unknown): ApiErrorCode | undefined {
  return error instanceof ApiClientError ? error.code : undefined;
}

type OperationErrorClassification = 'UNKNOWN' | 'RETRYABLE' | 'FAILED';

function classifyOperationError(error: unknown): OperationErrorClassification {
  const code = apiCode(error);
  if (code && UNCERTAIN_CODES.has(code)) return 'UNKNOWN';
  if (
    error instanceof ApiClientError &&
    (error.status === 0 || (error.status >= 500 && !error.code))
  ) {
    return 'RETRYABLE';
  }
  return 'FAILED';
}

function pendingStatus(
  classification: OperationErrorClassification,
): PrintingDeviceOperationStatus | null {
  if (classification === 'UNKNOWN') return 'UNKNOWN';
  if (classification === 'RETRYABLE') return 'RETRYABLE';
  return null;
}

function safeMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 401) {
    return '管理员会话已失效，请重新进入';
  }
  if (error instanceof ApiClientError && error.message) return error.message;
  return '打印机操作失败，请稍后重试';
}

function challengeMap(
  devices: readonly CloudPrinterView[],
): Readonly<Record<string, PrinterVerificationChallengeView>> {
  return devices.reduce<
    Readonly<Record<string, PrinterVerificationChallengeView>>
  >(
    (result, device) =>
      device.challenge
        ? { ...result, [device.id]: { ...device.challenge } }
        : result,
    {},
  );
}

function countdown(
  challenge: PrinterVerificationChallengeView | undefined,
  now: number,
): number {
  if (!challenge) return 0;
  const expiresAt = Date.parse(challenge.expiresAt);
  return Number.isFinite(expiresAt)
    ? Math.max(0, Math.ceil((expiresAt - now) / 1000))
    : 0;
}

export function createPrintingDevicesController(dependencies: Dependencies) {
  const storage = dependencies.storage ?? defaultStorage();
  const randomUUID = dependencies.randomUUID ?? createSecureUuidV4;
  const now = dependencies.now ?? Date.now;
  const operationRequests = new Map<string, OperationRequest>();
  const preparingOperations = new Set<string>();
  let state = emptyState();
  let ownerAdminId: string | null = null;
  let lastPrinterId: string | undefined;
  let listGeneration = 0;

  function currentAdminId(): string | null {
    return adminIdFromSession(dependencies.adminSession.get());
  }

  function removeStorage(): void {
    storage.remove(PRINTING_DEVICES_STORAGE_KEY);
  }

  function persistLifecycleState(): void {
    const adminId = currentAdminId();
    if (!adminId) {
      removeStorage();
      return;
    }
    storage.set(PRINTING_DEVICES_STORAGE_KEY, {
      adminId,
      ...(lastPrinterId ? { lastPrinterId } : {}),
      pendingDeviceOperations: state.operations.map(
        ({ operation, resourceId, idempotencyKey }) => ({
          operation,
          ...(resourceId ? { resourceId } : {}),
          idempotencyKey,
        }),
      ),
    } satisfies PersistedState);
  }

  function clearOperations(): void {
    operationRequests.clear();
    state = {
      ...state,
      operations: [],
      operationMap: {},
      manualContinueRequired: false,
    };
    lastPrinterId = undefined;
    removeStorage();
  }

  function hydrate(): void {
    const adminId = currentAdminId();
    const raw = storage.get(PRINTING_DEVICES_STORAGE_KEY);
    if (!adminId || raw === undefined || raw === null || raw === '') return;
    if (!isPersistedState(raw, adminId)) {
      clearOperations();
      return;
    }
    ownerAdminId = adminId;
    lastPrinterId = raw.lastPrinterId;
    const operations = raw.pendingDeviceOperations.map((operation) => ({
      ...operation,
      status: 'UNKNOWN' as const,
      wasUncertain: true as const,
    }));
    state = {
      ...state,
      operations,
      operationMap: Object.fromEntries(
        operations.map((operation) => [
          identity(operation.operation, operation.resourceId),
          operation.status,
        ]),
      ),
      manualContinueRequired: operations.length > 0,
    };
  }

  hydrate();

  function snapshot(): PrintingDevicesState {
    return cloneState(state);
  }

  function authorized(): boolean {
    const session = dependencies.adminSession.get();
    const adminId = adminIdFromSession(session);
    if (!session || !adminId || session.mustChangePassword) return false;
    if (ownerAdminId && ownerAdminId !== adminId) clearOperations();
    ownerAdminId = adminId;
    const allowed = session.permissions.some(
      (permission) => permission === AdminPermission.PRINT_DEVICE_MANAGE,
    );
    if (!allowed) {
      dependencies.adminSession.clear();
      clearOperations();
    }
    return allowed;
  }

  function syncAdminIdentity(): void {
    const adminId = currentAdminId();
    if (!adminId || (ownerAdminId && ownerAdminId !== adminId)) {
      clearOperations();
    }
    ownerAdminId = adminId;
  }

  function replaceOperation(next: PendingDeviceOperation): void {
    const operationId = identity(next.operation, next.resourceId);
    const operations = [
      ...state.operations.filter(
        (operation) =>
          identity(operation.operation, operation.resourceId) !== operationId,
      ),
      next,
    ];
    state = {
      ...state,
      operations,
      operationMap: { ...state.operationMap, [operationId]: next.status },
      manualContinueRequired: operations.some(
        (operation) => operation.status !== 'PENDING',
      ),
    };
    persistLifecycleState();
  }

  function releaseOperation(
    operation: PrintingDeviceOperation,
    resourceId: string | undefined,
    idempotencyKey: string,
  ): void {
    const operationId = identity(operation, resourceId);
    const current = state.operations.find(
      (candidate) =>
        identity(candidate.operation, candidate.resourceId) === operationId,
    );
    if (current?.idempotencyKey !== idempotencyKey) return;
    const operations = state.operations.filter(
      (candidate) =>
        identity(candidate.operation, candidate.resourceId) !== operationId,
    );
    state = {
      ...state,
      operations,
      operationMap: Object.fromEntries(
        Object.entries(state.operationMap).filter(
          ([key]) => key !== operationId,
        ),
      ),
      manualContinueRequired: operations.some(
        (candidate) => candidate.status !== 'PENDING',
      ),
    };
    operationRequests.delete(operationId);
    persistLifecycleState();
  }

  function updateStatus(
    operation: PrintingDeviceOperation,
    resourceId: string | undefined,
    idempotencyKey: string,
    status: PrintingDeviceOperationStatus,
  ): void {
    const operationId = identity(operation, resourceId);
    const operations = state.operations.map((candidate) =>
      identity(candidate.operation, candidate.resourceId) === operationId &&
      candidate.idempotencyKey === idempotencyKey
        ? {
            ...candidate,
            status,
            ...((candidate.wasUncertain || status !== 'PENDING') && {
              wasUncertain: true as const,
            }),
          }
        : candidate,
    );
    state = {
      ...state,
      operations,
      operationMap: { ...state.operationMap, [operationId]: status },
      manualContinueRequired: operations.some(
        (candidate) => candidate.status !== 'PENDING',
      ),
    };
    persistLifecycleState();
  }

  function upsertDevice(device: CloudPrinterView): void {
    const exists = state.devices.some(
      (candidate) => candidate.id === device.id,
    );
    const devices = exists
      ? state.devices.map((candidate) =>
          candidate.id === device.id ? { ...device } : candidate,
        )
      : [{ ...device }, ...state.devices];
    const challenges = device.challenge
      ? {
          ...state.challengeByPrinterId,
          [device.id]: { ...device.challenge },
        }
      : Object.fromEntries(
          Object.entries(state.challengeByPrinterId).filter(
            ([id]) => id !== device.id,
          ),
        );
    state = { ...state, devices, challengeByPrinterId: challenges };
  }

  function selectChallenge(printerId: string): void {
    const selected = state.challengeByPrinterId[printerId];
    state = {
      ...state,
      countdownSeconds: countdown(selected, now()),
      remainingAttempts: selected?.remainingAttempts ?? 0,
    };
  }

  async function load(): Promise<void> {
    const requestGeneration = listGeneration + 1;
    const mutationGeneration = state.mutationGeneration;
    listGeneration = requestGeneration;
    state = { ...state, loading: true, error: null };
    try {
      const result = await dependencies.api.list({
        page: state.page,
        pageSize: state.pageSize,
      });
      if (
        requestGeneration !== listGeneration ||
        mutationGeneration !== state.mutationGeneration
      ) {
        return;
      }
      const devices = result.items.map((device) => ({ ...device }));
      const challenges = challengeMap(devices);
      const selectedId = state.dialog.resourceId;
      state = {
        ...state,
        devices,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        challengeByPrinterId: challenges,
        ...(selectedId
          ? {
              countdownSeconds: countdown(challenges[selectedId], now()),
              remainingAttempts: challenges[selectedId]?.remainingAttempts ?? 0,
            }
          : {}),
      };
      if (
        lastPrinterId &&
        !devices.some(
          (device) =>
            device.id === lastPrinterId &&
            device.status === CloudPrinterStatus.ACTIVE,
        )
      ) {
        lastPrinterId = undefined;
      }
    } catch (error) {
      if (requestGeneration === listGeneration) {
        state = { ...state, error: safeMessage(error) };
      }
      throw error;
    } finally {
      if (requestGeneration === listGeneration)
        state = { ...state, loading: false };
    }
  }

  function callOperation(
    request: OperationRequest,
    idempotencyKey: string,
  ): Promise<OperationResult> {
    switch (request.operation) {
      case 'bind':
        return dependencies.api.bind(request.body, idempotencyKey);
      case 'confirm':
        return dependencies.api.confirm(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'resend':
        return dependencies.api.resend(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'refresh':
        return dependencies.api.refresh(request.resourceId, {}, idempotencyKey);
      case 'requery':
        return dependencies.api.requery(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'delete-confirm':
        return dependencies.api.confirmDeletion(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'unbind':
        return dependencies.api.unbind(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
      case 'rename':
        return dependencies.api.rename(
          request.resourceId,
          request.body,
          idempotencyKey,
        );
    }
  }

  function applyResult(
    request: OperationRequest,
    result: OperationResult,
  ): void {
    upsertDevice(result.printer);
    if ('challenge' in result) {
      const challenge = { ...result.challenge };
      state = {
        ...state,
        challengeByPrinterId: {
          ...state.challengeByPrinterId,
          [result.printer.id]: challenge,
        },
        dialog: { kind: 'verify', resourceId: result.printer.id },
        forms: {
          ...state.forms,
          verify: {
            challengeId: challenge.challengeId,
            code: '',
            operationPassword: '',
          },
        },
        countdownSeconds: countdown(challenge, now()),
        remainingAttempts: challenge.remainingAttempts,
      };
    } else if (request.operation !== 'refresh') {
      state = { ...state, dialog: { kind: null } };
    }
  }

  async function authoritativeReload(primaryError: string): Promise<void> {
    try {
      await load();
    } catch {
      state = { ...state, error: primaryError };
    }
  }

  async function execute(
    request: OperationRequest,
    idempotencyKey: string,
  ): Promise<OperationResult> {
    const resourceId = 'resourceId' in request ? request.resourceId : undefined;
    const operationId = identity(request.operation, resourceId);
    updateStatus(request.operation, resourceId, idempotencyKey, 'PENDING');
    try {
      const result = await callOperation(request, idempotencyKey);
      const current = state.operations.find(
        (candidate) =>
          identity(candidate.operation, candidate.resourceId) === operationId,
      );
      if (current?.idempotencyKey !== idempotencyKey) return result;
      applyResult(request, result);
      releaseOperation(request.operation, resourceId, idempotencyKey);
      await authoritativeReload('打印机列表刷新失败，请手动重试');
      return result;
    } catch (error) {
      const current = state.operations.find(
        (candidate) =>
          identity(candidate.operation, candidate.resourceId) === operationId &&
          candidate.idempotencyKey === idempotencyKey,
      );
      if (!current) throw error;
      const classification = classifyOperationError(error);
      const status = pendingStatus(classification);
      const message = safeMessage(error);
      if (status) {
        updateStatus(request.operation, resourceId, idempotencyKey, status);
      } else {
        releaseOperation(request.operation, resourceId, idempotencyKey);
      }
      state = { ...state, error: message };
      const code = apiCode(error);
      if (
        request.operation === 'confirm' &&
        code !== undefined &&
        AUTHORITATIVE_CONFIRM_CODES.has(code)
      ) {
        await authoritativeReload(message);
        if (
          code === ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED
        ) {
          state = {
            ...state,
            forms: {
              ...state.forms,
              verify: { challengeId: '', code: '', operationPassword: '' },
            },
            countdownSeconds: 0,
            remainingAttempts: 0,
          };
        }
        state = { ...state, error: message };
      } else if (classification === 'FAILED') {
        await authoritativeReload(message);
        state = { ...state, error: message };
      }
      throw error;
    }
  }

  async function begin(request: OperationRequest): Promise<OperationResult> {
    const resourceId = 'resourceId' in request ? request.resourceId : undefined;
    const operationId = identity(request.operation, resourceId);
    if (
      preparingOperations.has(operationId) ||
      state.operations.some(
        (candidate) =>
          identity(candidate.operation, candidate.resourceId) === operationId,
      )
    ) {
      throw new Error('该打印机操作正在准备或等待恢复，请勿重复提交');
    }
    preparingOperations.add(operationId);
    try {
      const idempotencyKey = await requireUuidV4(randomUUID);
      operationRequests.set(operationId, request);
      state = { ...state, mutationGeneration: state.mutationGeneration + 1 };
      replaceOperation({
        operation: request.operation,
        ...(resourceId ? { resourceId } : {}),
        idempotencyKey,
        status: 'PENDING',
      });
      return execute(request, idempotencyKey);
    } finally {
      preparingOperations.delete(operationId);
    }
  }

  function requestForContinue(
    operation: PrintingDeviceOperation,
    resourceId?: string,
  ): OperationRequest {
    const remembered = operationRequests.get(identity(operation, resourceId));
    if (remembered) return remembered;
    if (operation === 'bind')
      return { operation, body: { ...state.forms.bind } };
    if (!resourceId) throw new Error('缺少打印机 ID，无法继续操作');
    if (operation === 'confirm') {
      return { operation, resourceId, body: { ...state.forms.verify } };
    }
    if (operation === 'refresh') return { operation, resourceId };
    if (operation === 'rename') {
      return { operation, resourceId, body: { ...state.forms.rename } };
    }
    return {
      operation,
      resourceId,
      body: { operationPassword: state.forms.recoveryPassword },
    };
  }

  function clearContinuedSensitiveForm(request: OperationRequest): void {
    if (request.operation === 'bind') {
      state = {
        ...state,
        forms: {
          ...state.forms,
          bind: {
            serialNumber: '',
            displayName: request.body.displayName,
            operationPassword: '',
          },
        },
      };
    } else if (request.operation === 'confirm') {
      state = {
        ...state,
        forms: {
          ...state.forms,
          verify: {
            challengeId: request.body.challengeId,
            code: '',
            operationPassword: '',
          },
        },
      };
    } else if (
      request.operation === 'resend' ||
      request.operation === 'requery' ||
      request.operation === 'delete-confirm' ||
      request.operation === 'unbind'
    ) {
      state = {
        ...state,
        forms: { ...state.forms, recoveryPassword: '' },
      };
    }
  }

  function continueOperation(
    operation: PrintingDeviceOperation,
    resourceId?: string,
  ): Promise<OperationResult> {
    const pending = state.operations.find(
      (candidate) =>
        identity(candidate.operation, candidate.resourceId) ===
        identity(operation, resourceId),
    );
    if (!pending) throw new Error('没有可继续的打印机操作');
    const request = requestForContinue(operation, resourceId);
    clearContinuedSensitiveForm(request);
    operationRequests.set(identity(operation, resourceId), request);
    return execute(request, pending.idempotencyKey);
  }

  function setBindForm(form: PrintingDevicesState['forms']['bind']): void {
    state = { ...state, forms: { ...state.forms, bind: { ...form } } };
  }

  function setVerifyForm(
    form: Pick<
      PrintingDevicesState['forms']['verify'],
      'code' | 'operationPassword'
    >,
  ): void {
    state = {
      ...state,
      forms: {
        ...state.forms,
        verify: { ...state.forms.verify, ...form },
      },
    };
  }

  function setRecoveryPassword(recoveryPassword: string): void {
    state = { ...state, forms: { ...state.forms, recoveryPassword } };
  }

  function setRenameName(displayName: string): void {
    state = {
      ...state,
      forms: { ...state.forms, rename: { displayName } },
    };
  }

  function openBind(): void {
    state = {
      ...state,
      dialog: { kind: 'bind' },
      forms: {
        ...state.forms,
        bind: { serialNumber: '', displayName: '', operationPassword: '' },
      },
      error: null,
    };
  }

  function openVerify(device: CloudPrinterView): void {
    const challenge = device.challenge ?? state.challengeByPrinterId[device.id];
    state = {
      ...state,
      dialog: { kind: 'verify', resourceId: device.id },
      challengeByPrinterId: challenge
        ? { ...state.challengeByPrinterId, [device.id]: { ...challenge } }
        : state.challengeByPrinterId,
      forms: {
        ...state.forms,
        verify: {
          challengeId: challenge?.challengeId ?? '',
          code: '',
          operationPassword: '',
        },
      },
      error: null,
    };
    selectChallenge(device.id);
  }

  function openRecovery(
    action: 'resend' | 'requery' | 'delete-confirm' | 'unbind',
    device: CloudPrinterView,
  ): void {
    state = {
      ...state,
      dialog: {
        kind: 'recovery',
        resourceId: device.id,
        recoveryAction: action,
      },
      forms: { ...state.forms, recoveryPassword: '' },
      error: null,
    };
  }

  function openRename(device: CloudPrinterView): void {
    state = {
      ...state,
      dialog: { kind: 'rename', resourceId: device.id },
      forms: { ...state.forms, rename: { displayName: device.displayName } },
      error: null,
    };
  }

  function closeDialog(): void {
    state = {
      ...state,
      dialog: { kind: null },
      forms: {
        bind: { serialNumber: '', displayName: '', operationPassword: '' },
        verify: {
          challengeId: state.forms.verify.challengeId,
          code: '',
          operationPassword: '',
        },
        recoveryPassword: '',
        rename: { displayName: '' },
      },
    };
  }

  function bind(): Promise<BindCloudPrinterResult> {
    const body = { ...state.forms.bind };
    state = {
      ...state,
      forms: {
        ...state.forms,
        bind: {
          serialNumber: '',
          displayName: body.displayName,
          operationPassword: '',
        },
      },
    };
    return begin({
      operation: 'bind',
      body,
    }) as Promise<BindCloudPrinterResult>;
  }

  function confirm(printerId: string): Promise<ConfirmCloudPrinterResult> {
    const body = { ...state.forms.verify };
    if (!body.challengeId) throw new Error('验证码信息缺失，请先刷新列表');
    if (state.remainingAttempts <= 0) {
      throw new Error('验证码尝试次数已耗尽，请重发验证码');
    }
    state = {
      ...state,
      forms: {
        ...state.forms,
        verify: {
          challengeId: body.challengeId,
          code: '',
          operationPassword: '',
        },
      },
    };
    return begin({
      operation: 'confirm',
      resourceId: printerId,
      body,
    }) as Promise<ConfirmCloudPrinterResult>;
  }

  function beginRecovery(
    operation: 'resend' | 'requery' | 'delete-confirm' | 'unbind',
    printerId: string,
  ): Promise<OperationResult> {
    const body = { operationPassword: state.forms.recoveryPassword };
    state = { ...state, forms: { ...state.forms, recoveryPassword: '' } };
    return begin({ operation, resourceId: printerId, body });
  }

  function resend(
    printerId: string,
  ): Promise<ResendCloudPrinterVerificationResult> {
    return beginRecovery(
      'resend',
      printerId,
    ) as Promise<ResendCloudPrinterVerificationResult>;
  }

  function refreshOnlineStatus(
    printerId: string,
  ): Promise<RefreshCloudPrinterOnlineStatusResult> {
    const pending = state.operations.find(
      (candidate) =>
        identity(candidate.operation, candidate.resourceId) ===
        identity('refresh', printerId),
    );
    if (pending) {
      return continueOperation(
        'refresh',
        printerId,
      ) as Promise<RefreshCloudPrinterOnlineStatusResult>;
    }
    return begin({
      operation: 'refresh',
      resourceId: printerId,
    }) as Promise<RefreshCloudPrinterOnlineStatusResult>;
  }

  function requery(
    printerId: string,
  ): Promise<RequeryCloudPrinterVendorRelationResult> {
    return beginRecovery(
      'requery',
      printerId,
    ) as Promise<RequeryCloudPrinterVendorRelationResult>;
  }

  function confirmDeletion(
    printerId: string,
  ): Promise<ConfirmCloudPrinterCompensationDeletionResult> {
    return beginRecovery(
      'delete-confirm',
      printerId,
    ) as Promise<ConfirmCloudPrinterCompensationDeletionResult>;
  }

  function unbind(printerId: string): Promise<UnbindCloudPrinterResult> {
    return beginRecovery(
      'unbind',
      printerId,
    ) as Promise<UnbindCloudPrinterResult>;
  }

  async function rename(printerId: string): Promise<RenameCloudPrinterResult> {
    const normalized = normalizeCloudPrinterDisplayName(
      state.forms.rename.displayName,
    );
    if (normalized === null) {
      const length = Array.from(state.forms.rename.displayName.trim()).length;
      throw new Error(
        length === 0 ? '打印机名称不能为空' : '打印机名称最多 64 个字符',
      );
    }
    state = {
      ...state,
      forms: { ...state.forms, rename: { displayName: normalized } },
    };
    return (await begin({
      operation: 'rename',
      resourceId: printerId,
      body: { displayName: normalized },
    })) as RenameCloudPrinterResult;
  }

  async function setPage(page: number): Promise<void> {
    state = { ...state, page };
    await load();
  }

  function updateCountdown(nowMs = now()): void {
    const printerId = state.dialog.resourceId;
    const selected = printerId
      ? state.challengeByPrinterId[printerId]
      : undefined;
    state = {
      ...state,
      countdownSeconds: countdown(selected, nowMs),
      remainingAttempts: selected?.remainingAttempts ?? 0,
    };
  }

  return {
    actionsFor: actionsForPrinter,
    authorized,
    bind,
    closeDialog,
    confirm,
    confirmDeletion,
    continueOperation,
    load,
    openBind,
    openRecovery,
    openRename,
    openVerify,
    persistLifecycleState,
    refreshOnlineStatus,
    rename,
    unbind,
    requery,
    resend,
    setBindForm,
    setPage,
    setRecoveryPassword,
    setRenameName,
    setVerifyForm,
    snapshot,
    syncAdminIdentity,
    updateCountdown,
  } as const;
}
