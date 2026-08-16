import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  type CloudPrinterListResult,
  type CloudPrinterView,
} from '@bake-mall/contracts';
import { nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../../api/http.js';
import { printingDevicesApi } from '../api/index.js';
import {
  PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
  adminIdFromAccessToken,
  usePrintingDevices,
} from './usePrintingDevices.js';

vi.mock('../api/index.js', () => ({
  printingDevicesApi: {
    list: vi.fn(),
    bind: vi.fn(),
    confirm: vi.fn(),
    resend: vi.fn(),
    refresh: vi.fn(),
    requery: vi.fn(),
    confirmDeletion: vi.fn(),
    rename: vi.fn(),
    detail: vi.fn(),
    current: vi.fn(),
    setCurrent: vi.fn(),
    clearCurrent: vi.fn(),
  },
}));

const api = vi.mocked(printingDevicesApi);
const UUIDS = [
  '123e4567-e89b-42d3-a456-426614174000',
  '223e4567-e89b-42d3-a456-426614174001',
  '323e4567-e89b-42d3-a456-426614174002',
  '423e4567-e89b-42d3-a456-426614174003',
  '523e4567-e89b-42d3-a456-426614174004',
  '623e4567-e89b-42d3-a456-426614174005',
  '723e4567-e89b-42d3-a456-426614174006',
  '823e4567-e89b-42d3-a456-426614174007',
] as const;

const challenge = {
  challengeId: '1001',
  expiresAt: '2026-08-09T10:05:00.000Z',
  remainingAttempts: 3,
};
const printer: CloudPrinterView = {
  id: '1001',
  displayName: '前台出单机',
  serialNumberMasked: 'SN****01',
  status: CloudPrinterStatus.PENDING_VERIFICATION,
  onlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
  lastStatusCheckedAt: null,
  bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
  vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
  isCurrent: false,
  challenge,
};
const activePrinter: CloudPrinterView = {
  ...printer,
  status: CloudPrinterStatus.ACTIVE,
  bindingStage: PrinterBindingStage.NONE,
  onlineStatus: CloudPrinterOnlineStatus.ONLINE,
  lastStatusCheckedAt: '2026-08-09T10:00:00.000Z',
};
const listResult: CloudPrinterListResult = {
  items: [printer],
  total: 1,
  page: 1,
  pageSize: 20,
};
type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function installUuidSequence(): void {
  const randomUUID = vi.fn();
  UUIDS.forEach((uuid) => randomUUID.mockReturnValueOnce(uuid));
  vi.stubGlobal('crypto', { randomUUID });
}

function createState(adminId = ref<string | null>('42')) {
  return usePrintingDevices({
    adminId,
    now: () => Date.parse('2026-08-09T10:00:00.000Z'),
  });
}

function networkError(): ApiClientError {
  return new ApiClientError(0, '网络异常,请稍后重试');
}

function unknownError(code = ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN) {
  return new ApiClientError(409, '结果未知', { code });
}

function expectCanonicalUuid(value: string): void {
  expect(value).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  installUuidSequence();
  api.list.mockResolvedValue(listResult);
  api.current.mockResolvedValue({
    printer: null,
    revision: 0,
    updatedAt: '2026-08-09T10:00:00.000Z',
  });
  api.detail.mockResolvedValue(activePrinter);
});

describe('printing operation idempotency', () => {
  const cases = [
    {
      label: 'bind',
      operation: 'bind' as const,
      resourceId: undefined,
      prime(state: ReturnType<typeof createState>) {
        state.bindForm.value = {
          serialNumber: 'SN-1001',
          displayName: '前台出单机',
          operationPassword: 'secret',
        };
      },
      start(state: ReturnType<typeof createState>) {
        return state.bind();
      },
      mock() {
        return api.bind;
      },
      success: { printer, challenge },
    },
    {
      label: 'confirm',
      operation: 'confirm' as const,
      resourceId: printer.id,
      prime(state: ReturnType<typeof createState>) {
        state.verifyForm.value = {
          challengeId: printer.id,
          code: '123456',
          operationPassword: 'secret',
        };
      },
      start(state: ReturnType<typeof createState>) {
        return state.confirm(printer.id);
      },
      mock() {
        return api.confirm;
      },
      success: { printer: activePrinter },
    },
    {
      label: 'resend',
      operation: 'resend' as const,
      resourceId: printer.id,
      prime(state: ReturnType<typeof createState>) {
        state.recoveryForm.value = { operationPassword: 'secret' };
      },
      start(state: ReturnType<typeof createState>) {
        return state.resend(printer.id);
      },
      mock() {
        return api.resend;
      },
      success: { printer, challenge },
    },
    {
      label: 'refresh',
      operation: 'refresh' as const,
      resourceId: printer.id,
      prime() {},
      start(state: ReturnType<typeof createState>) {
        return state.refreshOnlineStatus(printer.id);
      },
      mock() {
        return api.refresh;
      },
      success: { printer: activePrinter },
    },
    {
      label: 'requery',
      operation: 'requery' as const,
      resourceId: printer.id,
      prime(state: ReturnType<typeof createState>) {
        state.recoveryForm.value = { operationPassword: 'secret' };
      },
      start(state: ReturnType<typeof createState>) {
        return state.requery(printer.id);
      },
      mock() {
        return api.requery;
      },
      success: { printer: activePrinter },
    },
    {
      label: 'delete-confirm',
      operation: 'delete-confirm' as const,
      resourceId: printer.id,
      prime(state: ReturnType<typeof createState>) {
        state.recoveryForm.value = { operationPassword: 'secret' };
      },
      start(state: ReturnType<typeof createState>) {
        return state.confirmDeletion(printer.id);
      },
      mock() {
        return api.confirmDeletion;
      },
      success: { printer: activePrinter },
    },
    {
      label: 'rename',
      operation: 'rename' as const,
      resourceId: printer.id,
      prime(state: ReturnType<typeof createState>) {
        state.renameForm.value = { displayName: '  新名字  ' };
      },
      start(state: ReturnType<typeof createState>) {
        return state.rename(printer.id);
      },
      mock() {
        return api.rename;
      },
      success: { printer: { ...printer, displayName: '新名字' } },
    },
  ] as const;

  it.each(cases)(
    '$label creates one key, retries timeout with the same key, keeps unknown, releases stable, and a new explicit operation gets a new key',
    async (testCase) => {
      const state = createState();
      testCase.prime(state);
      const method = testCase.mock();
      method.mockRejectedValueOnce(networkError());

      await expect(testCase.start(state)).rejects.toMatchObject({ status: 0 });
      const firstKey = method.mock.calls[0]?.at(-1) as string;
      expectCanonicalUuid(firstKey);
      expect(state.pendingOperations.value).toContainEqual(
        expect.objectContaining({
          operation: testCase.operation,
          ...(testCase.resourceId ? { resourceId: testCase.resourceId } : {}),
          idempotencyKey: firstKey,
          status: 'RETRYABLE',
          wasUncertain: true,
        }),
      );

      method.mockRejectedValueOnce(unknownError());
      await expect(
        state.retryOperation(testCase.operation, testCase.resourceId),
      ).rejects.toMatchObject({
        code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
      });
      expect(method.mock.calls[1]?.at(-1)).toBe(firstKey);
      expect(state.pendingOperations.value[0]?.status).toBe('UNKNOWN');

      method.mockResolvedValueOnce(testCase.success as never);
      await state.retryOperation(testCase.operation, testCase.resourceId);
      expect(method.mock.calls[2]?.at(-1)).toBe(firstKey);
      expect(state.pendingOperations.value).toEqual([]);

      testCase.prime(state);
      method.mockResolvedValueOnce(testCase.success as never);
      await testCase.start(state);
      const nextKey = method.mock.calls[3]?.at(-1) as string;
      expectCanonicalUuid(nextKey);
      expect(nextKey).not.toBe(firstKey);
    },
  );

  it.each([
    ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
    ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
  ])('retains the operation key for %s', async (code) => {
    api.refresh.mockRejectedValueOnce(unknownError(code));
    const state = createState();

    await expect(state.refreshOnlineStatus(printer.id)).rejects.toMatchObject({
      code,
    });

    expect(state.pendingOperations.value).toMatchObject([
      { operation: 'refresh', resourceId: printer.id, status: 'UNKNOWN' },
    ]);
    expect(state.error.value?.kind).toBe('unknown');
  });

  it('releases the key for a stable business failure, reloads authoritatively, and preserves the primary error', async () => {
    const authoritative = {
      ...activePrinter,
      onlineStatus: CloudPrinterOnlineStatus.OFFLINE,
    };
    api.refresh.mockRejectedValueOnce(
      new ApiClientError(422, '设备离线', {
        code: ApiErrorCode.CLOUD_PRINTER_OFFLINE,
      }),
    );
    api.list.mockResolvedValueOnce({ ...listResult, items: [authoritative] });
    const state = createState();

    await expect(state.refreshOnlineStatus(printer.id)).rejects.toMatchObject({
      code: ApiErrorCode.CLOUD_PRINTER_OFFLINE,
    });

    expect(state.pendingOperations.value).toEqual([]);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(state.devices.value).toEqual([authoritative]);
    expect(state.error.value).toMatchObject({
      kind: 'stable',
      message: '设备离线',
    });
  });

  it('keeps the key for a 5xx response-lost outcome without a stable failure code', async () => {
    api.refresh.mockRejectedValueOnce(new ApiClientError(503, '上游响应丢失'));
    const state = createState();

    await expect(state.refreshOnlineStatus(printer.id)).rejects.toMatchObject({
      status: 503,
    });

    expect(state.pendingOperations.value).toMatchObject([
      { operation: 'refresh', resourceId: printer.id, status: 'RETRYABLE' },
    ]);
    expect(state.error.value).toMatchObject({ kind: 'retryable' });
  });

  it.each([
    new ApiClientError(409, '请求体冲突', {
      code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
    }),
    new ApiClientError(403, '操作密码错误', {
      code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
    }),
    new ApiClientError(429, '操作验证频繁', {
      code: ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
    }),
    new ApiClientError(403, '权限不足', {
      code: ApiErrorCode.ADMIN_PERMISSION_DENIED,
    }),
    new ApiClientError(422, '参数无效', {
      code: ApiErrorCode.CLOUD_PRINTER_NAME_INVALID,
    }),
  ])(
    'releases a previously uncertain key after stable failure %s',
    async (replayError) => {
      api.rename
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(replayError);
      const state = createState();
      state.renameForm.value = { displayName: '新名字' };
      await expect(state.rename(printer.id)).rejects.toThrow();
      const key = api.rename.mock.calls[0]?.at(-1);

      state.renameForm.value = { displayName: '不同名字' };
      await expect(state.retryOperation('rename', printer.id)).rejects.toBe(
        replayError,
      );

      expect(api.rename.mock.calls[1]?.at(-1)).toBe(key);
      expect(state.pendingOperations.value).toEqual([]);
      expect(state.error.value).toMatchObject({
        kind: 'stable',
        message: replayError.message,
      });
    },
  );

  it('releases a hydrated key after a different-body conflict and starts the corrected request with a new key', async () => {
    window.sessionStorage.setItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
      JSON.stringify({
        adminId: '42',
        pendingDeviceOperations: [
          {
            operation: 'rename',
            resourceId: printer.id,
            idempotencyKey: UUIDS[7],
          },
        ],
      }),
    );
    const state = createState();
    state.renameForm.value = { displayName: '错误重输名称' };
    api.rename.mockRejectedValueOnce(
      new ApiClientError(409, '请求体冲突', {
        code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
      }),
    );

    await expect(state.retryOperation('rename', printer.id)).rejects.toThrow();
    expect(state.pendingOperations.value).toEqual([]);

    state.renameForm.value = { displayName: '原请求名称' };
    api.rename.mockResolvedValueOnce({
      printer: { ...activePrinter, displayName: '原请求名称' },
    });
    await state.rename(printer.id);

    expect(api.rename.mock.calls.map((call) => call.at(-1))).toEqual([
      UUIDS[7],
      UUIDS[0],
    ]);
    expect(state.pendingOperations.value).toEqual([]);
  });
});

describe('authoritative current printer, filters, detail, and compatibility', () => {
  it('loads the list and current view together, switches removed filter, and opens authoritative detail', async () => {
    const currentPrinter = { ...activePrinter, isCurrent: true };
    api.current.mockResolvedValue({
      printer: currentPrinter,
      revision: 4,
      updatedAt: '2026-08-09T10:00:00.000Z',
    });
    api.detail.mockResolvedValueOnce(currentPrinter);
    const state = createState();

    await state.load();
    await state.setListScope('removed');
    await state.openDetail(activePrinter.id);

    expect(api.current).toHaveBeenCalledTimes(2);
    expect(api.list).toHaveBeenNthCalledWith(1, {
      page: 1,
      pageSize: 20,
      includeUnbound: false,
    });
    expect(api.list).toHaveBeenNthCalledWith(2, {
      page: 1,
      pageSize: 20,
      includeUnbound: true,
      status: CloudPrinterStatus.UNBOUND,
    });
    expect(state.current.value).toMatchObject({ revision: 4 });
    expect(state.detail.value).toEqual(currentPrinter);
    expect(state.dialog.value.kind).toBe('detail');
  });

  it('sets current with the authoritative revision and refreshes current/list after 409', async () => {
    api.current
      .mockResolvedValueOnce({
        printer: null,
        revision: 2,
        updatedAt: '2026-08-09T10:00:00.000Z',
      })
      .mockResolvedValueOnce({
        printer: { ...activePrinter, isCurrent: true },
        revision: 3,
        updatedAt: '2026-08-09T10:01:00.000Z',
      });
    api.setCurrent.mockRejectedValueOnce(
      new ApiClientError(409, '当前打印机已被其他管理员修改', {
        code: ApiErrorCode.CLOUD_PRINTER_CURRENT_VERSION_CONFLICT,
      }),
    );
    const state = createState();
    await state.load();
    state.recoveryForm.value = { operationPassword: 'secret' };

    await expect(state.setCurrent(activePrinter.id)).rejects.toMatchObject({
      status: 409,
    });

    expect(api.setCurrent).toHaveBeenCalledWith(
      {
        printerId: activePrinter.id,
        expectedRevision: 2,
        operationPassword: 'secret',
      },
      UUIDS[0],
    );
    expect(api.current).toHaveBeenCalledTimes(2);
    expect(state.current.value).toMatchObject({ revision: 3 });
    expect(state.pendingOperations.value).toEqual([]);
  });

  it.each(['set-current', 'clear-current'] as const)(
    'hydrates %s with its original revision and never substitutes a newer authoritative revision',
    async (operation) => {
      window.sessionStorage.setItem(
        PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
        JSON.stringify({
          adminId: '42',
          pendingDeviceOperations: [
            {
              operation,
              resourceId: activePrinter.id,
              idempotencyKey: UUIDS[0],
              expectedRevision: 7,
            },
          ],
        }),
      );
      api.current.mockResolvedValueOnce({
        printer: { ...activePrinter, isCurrent: true },
        revision: 12,
        updatedAt: '2026-08-09T10:02:00.000Z',
      });
      const state = createState();
      await state.load();
      state.recoveryForm.value = { operationPassword: 'current-secret' };
      const result = {
        current: {
          printer: operation === 'set-current' ? activePrinter : null,
          revision: 8,
          updatedAt: '2026-08-09T10:03:00.000Z',
        },
      };
      const method = operation === 'set-current' ? api.setCurrent : api.clearCurrent;
      method.mockResolvedValueOnce(result as never);

      await state.retryOperation(operation, activePrinter.id);

      expect(method).toHaveBeenCalledWith(
        operation === 'set-current'
          ? {
              printerId: activePrinter.id,
              expectedRevision: 7,
              operationPassword: 'current-secret',
            }
          : { expectedRevision: 7, operationPassword: 'current-secret' },
        UUIDS[0],
      );
    },
  );

  it.each(['set-current', 'clear-current'] as const)(
    'fails safe for legacy hydrated %s without a revision and can discard it after authoritative refresh',
    async (operation) => {
      window.sessionStorage.setItem(
        PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
        JSON.stringify({
          adminId: '42',
          pendingDeviceOperations: [
            {
              operation,
              resourceId: activePrinter.id,
              idempotencyKey: UUIDS[0],
            },
          ],
        }),
      );
      const state = createState();
      state.recoveryForm.value = { operationPassword: 'current-secret' };

      await expect(
        state.retryOperation(operation, activePrinter.id),
      ).rejects.toThrow('缺少原始版本，无法安全重试');
      expect(state.error.value).toMatchObject({
        kind: 'stable',
        message: expect.stringContaining('缺少原始版本，无法安全重试'),
      });
      expect(api.setCurrent).not.toHaveBeenCalled();
      expect(api.clearCurrent).not.toHaveBeenCalled();

      await state.load();
      state.discardPendingOperation(operation, activePrinter.id);
      expect(state.pendingOperations.value).toEqual([]);
      expect(
        window.sessionStorage.getItem(PENDING_DEVICE_OPERATIONS_STORAGE_KEY),
      ).toBeNull();
    },
  );

  it('validates bind SN, display name, operation password, and six-digit confirmation before requests', async () => {
    const state = createState();
    state.bindForm.value = {
      serialNumber: 'bad sn',
      displayName: '  ',
      operationPassword: '',
    };
    await expect(state.bind()).rejects.toThrow('设备序列号格式不正确');
    expect(api.bind).not.toHaveBeenCalled();

    state.openVerify(printer);
    state.verifyForm.value = {
      challengeId: challenge.challengeId,
      code: '12ab',
      operationPassword: 'secret',
    };
    await expect(state.confirm(printer.id)).rejects.toThrow('验证码必须为 6 位数字');
    expect(api.confirm).not.toHaveBeenCalled();
  });

  it('hydrates pending operations when Object.hasOwn is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object, 'hasOwn');
    Object.defineProperty(Object, 'hasOwn', { configurable: true, value: undefined });
    try {
      window.sessionStorage.setItem(
        PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
        JSON.stringify({
          adminId: '42',
          pendingDeviceOperations: [
            {
              operation: 'refresh',
              resourceId: printer.id,
              idempotencyKey: UUIDS[0],
            },
          ],
        }),
      );
      const state = createState();
      expect(state.pendingOperations.value).toHaveLength(1);
    } finally {
      if (descriptor) Object.defineProperty(Object, 'hasOwn', descriptor);
      else Reflect.deleteProperty(Object, 'hasOwn');
    }
  });
});

describe('sensitive forms, storage, hydration, and identity', () => {
  it('clears bind serial/password and confirm code/password immediately after submission', async () => {
    const bindPending = deferred<{
      printer: CloudPrinterView;
      challenge: typeof challenge;
    }>();
    const confirmPending = deferred<{ printer: CloudPrinterView }>();
    api.bind.mockReturnValueOnce(bindPending.promise);
    api.confirm.mockReturnValueOnce(confirmPending.promise);
    const state = createState();
    state.bindForm.value = {
      serialNumber: 'SN-1001',
      displayName: '前台出单机',
      operationPassword: 'bind-secret',
    };

    const binding = state.bind();
    expect(state.bindForm.value).toEqual({
      serialNumber: '',
      displayName: '前台出单机',
      operationPassword: '',
    });
    expect(api.bind).toHaveBeenCalledWith(
      {
        serialNumber: 'SN-1001',
        displayName: '前台出单机',
        operationPassword: 'bind-secret',
      },
      UUIDS[0],
    );
    bindPending.resolve({ printer, challenge });
    await binding;

    state.verifyForm.value = {
      challengeId: printer.id,
      code: '123456',
      operationPassword: 'confirm-secret',
    };
    const confirming = state.confirm(printer.id);
    expect(state.verifyForm.value).toEqual({
      challengeId: printer.id,
      code: '',
      operationPassword: '',
    });
    confirmPending.resolve({ printer: activePrinter });
    await confirming;
  });

  it('clears re-entered bind, confirm, and recovery secrets immediately when continuing hydrated operations', async () => {
    const bindPending = deferred<{
      printer: CloudPrinterView;
      challenge: typeof challenge;
    }>();
    window.sessionStorage.setItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
      JSON.stringify({
        adminId: '42',
        pendingDeviceOperations: [
          { operation: 'bind', idempotencyKey: UUIDS[0] },
        ],
      }),
    );
    const bindState = createState();
    bindState.bindForm.value = {
      serialNumber: 'SN-REENTERED',
      displayName: '前台出单机',
      operationPassword: 'bind-secret',
    };
    api.bind.mockReturnValueOnce(bindPending.promise);

    const binding = bindState.retryOperation('bind');

    expect(bindState.bindForm.value).toEqual({
      serialNumber: '',
      displayName: '前台出单机',
      operationPassword: '',
    });
    bindPending.resolve({ printer, challenge });
    await binding;

    const confirmPending = deferred<{ printer: CloudPrinterView }>();
    window.sessionStorage.setItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
      JSON.stringify({
        adminId: '42',
        pendingDeviceOperations: [
          {
            operation: 'confirm',
            resourceId: printer.id,
            idempotencyKey: UUIDS[1],
          },
        ],
      }),
    );
    const confirmState = createState();
    confirmState.verifyForm.value = {
      challengeId: challenge.challengeId,
      code: '123456',
      operationPassword: 'confirm-secret',
    };
    api.confirm.mockReturnValueOnce(confirmPending.promise);

    const confirming = confirmState.retryOperation('confirm', printer.id);

    expect(confirmState.verifyForm.value).toEqual({
      challengeId: challenge.challengeId,
      code: '',
      operationPassword: '',
    });
    confirmPending.resolve({ printer: activePrinter });
    await confirming;

    const resendPending = deferred<{
      printer: CloudPrinterView;
      challenge: typeof challenge;
    }>();
    window.sessionStorage.setItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
      JSON.stringify({
        adminId: '42',
        pendingDeviceOperations: [
          {
            operation: 'resend',
            resourceId: printer.id,
            idempotencyKey: UUIDS[2],
          },
        ],
      }),
    );
    const resendState = createState();
    resendState.recoveryForm.value = { operationPassword: 'recovery-secret' };
    api.resend.mockReturnValueOnce(resendPending.promise);

    const resending = resendState.retryOperation('resend', printer.id);

    expect(resendState.recoveryForm.value).toEqual({ operationPassword: '' });
    resendPending.resolve({ printer, challenge });
    await resending;
  });

  it.each(['set-current', 'clear-current'] as const)(
    'clears the %s retry password immediately without changing the submitted body',
    async (operation) => {
      const pendingRequest = deferred<{
        current: {
          printer: CloudPrinterView | null;
          revision: number;
          updatedAt: string;
        };
      }>();
      window.sessionStorage.setItem(
        PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
        JSON.stringify({
          adminId: '42',
          pendingDeviceOperations: [
            {
              operation,
              resourceId: activePrinter.id,
              idempotencyKey: UUIDS[0],
              expectedRevision: 7,
            },
          ],
        }),
      );
      const state = createState();
      state.recoveryForm.value = { operationPassword: 'current-secret' };
      const method = operation === 'set-current' ? api.setCurrent : api.clearCurrent;
      method.mockReturnValueOnce(pendingRequest.promise as never);

      const retrying = state.retryOperation(operation, activePrinter.id);

      expect(state.recoveryForm.value.operationPassword).toBe('');
      expect(method).toHaveBeenCalledWith(
        operation === 'set-current'
          ? {
              printerId: activePrinter.id,
              expectedRevision: 7,
              operationPassword: 'current-secret',
            }
          : { expectedRevision: 7, operationPassword: 'current-secret' },
        UUIDS[0],
      );
      pendingRequest.resolve({
        current: {
          printer: operation === 'set-current' ? activePrinter : null,
          revision: 8,
          updatedAt: '2026-08-09T10:03:00.000Z',
        },
      });
      await retrying;
    },
  );

  it('persists only the strict adminId and operation-key whitelist', async () => {
    api.bind.mockRejectedValueOnce(networkError());
    const state = createState();
    state.bindForm.value = {
      serialNumber: 'SN-SECRET',
      displayName: 'Sensitive Name',
      operationPassword: 'password-secret',
    };

    await expect(state.bind()).rejects.toThrow();

    const raw = window.sessionStorage.getItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
    );
    expect(JSON.parse(raw!)).toEqual({
      adminId: '42',
      pendingDeviceOperations: [
        { operation: 'bind', idempotencyKey: UUIDS[0] },
      ],
    });
    expect(raw).not.toMatch(
      /token|SN-SECRET|Sensitive Name|password-secret|serialNumber|displayName|operationPassword/,
    );
  });

  it('hydrates only the same admin and clears pending data on logout or admin change', async () => {
    window.sessionStorage.setItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
      JSON.stringify({
        adminId: '42',
        pendingDeviceOperations: [
          {
            operation: 'refresh',
            resourceId: printer.id,
            idempotencyKey: UUIDS[0],
          },
        ],
      }),
    );
    const adminId = ref<string | null>('42');
    const state = createState(adminId);

    expect(state.pendingOperations.value).toEqual([
      {
        operation: 'refresh',
        resourceId: printer.id,
        idempotencyKey: UUIDS[0],
        status: 'UNKNOWN',
        wasUncertain: true,
      },
    ]);
    api.refresh.mockResolvedValueOnce({ printer: activePrinter });
    await state.retryOperation('refresh', printer.id);
    expect(api.refresh).toHaveBeenCalledWith(printer.id, {}, UUIDS[0]);

    window.sessionStorage.setItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
      JSON.stringify({
        adminId: '42',
        pendingDeviceOperations: [
          {
            operation: 'requery',
            resourceId: printer.id,
            idempotencyKey: UUIDS[1],
          },
        ],
      }),
    );
    const recovered = createState(adminId);
    recovered.recoveryForm.value = { operationPassword: 're-entered-secret' };
    api.requery.mockResolvedValueOnce({ printer: activePrinter });
    await recovered.retryOperation('requery', printer.id);
    expect(api.requery).toHaveBeenCalledWith(
      printer.id,
      { operationPassword: 're-entered-secret' },
      UUIDS[1],
    );

    adminId.value = '84';
    await nextTick();
    expect(state.pendingOperations.value).toEqual([]);
    expect(
      window.sessionStorage.getItem(PENDING_DEVICE_OPERATIONS_STORAGE_KEY),
    ).toBeNull();

    window.sessionStorage.setItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
      JSON.stringify({ adminId: '42', pendingDeviceOperations: [] }),
    );
    adminId.value = null;
    await nextTick();
    expect(
      window.sessionStorage.getItem(PENDING_DEVICE_OPERATIONS_STORAGE_KEY),
    ).toBeNull();
  });

  it('rejects malformed or mismatched persisted structures without hydrating secrets', () => {
    const values = [
      JSON.stringify({
        adminId: 'other-admin',
        pendingDeviceOperations: [
          {
            operation: 'refresh',
            resourceId: printer.id,
            idempotencyKey: UUIDS[0],
          },
        ],
      }),
      JSON.stringify({
        adminId: '42',
        token: 'secret-token',
        pendingDeviceOperations: [],
      }),
      JSON.stringify({
        adminId: '42',
        pendingDeviceOperations: [
          {
            operation: 'refresh',
            resourceId: printer.id,
            idempotencyKey: 'NOT-A-UUID',
          },
        ],
      }),
    ];

    values.forEach((value) => {
      window.sessionStorage.setItem(
        PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
        value,
      );
      const state = createState();
      expect(state.pendingOperations.value).toEqual([]);
      expect(
        window.sessionStorage.getItem(PENDING_DEVICE_OPERATIONS_STORAGE_KEY),
      ).toBeNull();
    });
  });

  it('derives only canonical admin sub from the in-memory JWT and never needs profile PII', () => {
    const payload = btoa(JSON.stringify({ sub: '42', aud: 'mall-admin' }));
    const token = `header.${payload}.signature`;

    expect(adminIdFromAccessToken(token)).toBe('42');
    expect(adminIdFromAccessToken('not-a-jwt')).toBeNull();
    expect(
      adminIdFromAccessToken(
        `header.${btoa(JSON.stringify({ sub: '42', aud: 'mall-user' }))}.sig`,
      ),
    ).toBeNull();
  });
});

describe('challenge, countdown, stale responses, and validation', () => {
  it('uses server expiresAt for the five-minute countdown and exposes remaining attempts', async () => {
    api.bind.mockResolvedValueOnce({ printer, challenge });
    const state = createState();
    state.bindForm.value = {
      serialNumber: 'SN-1001',
      displayName: '前台出单机',
      operationPassword: 'secret',
    };

    await state.bind();

    expect(state.challenge.value).toEqual(challenge);
    expect(state.countdownSeconds.value).toBe(300);
    expect(state.remainingAttempts.value).toBe(3);
    expect(state.challengeState.value).toBe('available');
    state.updateCountdown(Date.parse('2026-08-09T10:05:00.000Z'));
    expect(state.countdownSeconds.value).toBe(0);
    expect(state.challengeExpired.value).toBe(true);
    expect(state.challengeState.value).toBe('expired');
  });

  it('keeps challenges immutable by printer id and never carries A metadata into B', async () => {
    const printerB: CloudPrinterView = {
      ...printer,
      id: '1002',
      displayName: '后厨出单机',
      challenge: {
        challengeId: '1002',
        expiresAt: '2026-08-09T10:04:00.000Z',
        remainingAttempts: 2,
      },
    };
    api.list.mockResolvedValueOnce({
      ...listResult,
      items: [printer, printerB],
      total: 2,
    });
    const state = createState();
    await state.load();

    state.openVerify(printer);
    expect(state.challenge.value?.challengeId).toBe('1001');
    state.openVerify(printerB);
    expect(state.challenge.value?.challengeId).toBe('1002');
    expect(state.challengeByPrinterId.value).toEqual({
      '1001': challenge,
      '1002': printerB.challenge,
    });
  });

  it('labels missing challenge metadata as refresh-required rather than expired', () => {
    const withoutChallenge = { ...printer, challenge: undefined };
    const state = createState();

    state.openVerify(withoutChallenge);

    expect(state.challenge.value).toBeNull();
    expect(state.challengeState.value).toBe('metadata-missing');
    expect(state.challengeExpired.value).toBe(false);
  });

  it('restores a hydrated pending confirm after list challenge metadata arrives without auto-requesting', async () => {
    window.sessionStorage.setItem(
      PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
      JSON.stringify({
        adminId: '42',
        pendingDeviceOperations: [
          {
            operation: 'confirm',
            resourceId: printer.id,
            idempotencyKey: UUIDS[0],
          },
        ],
      }),
    );
    const state = createState();
    state.openVerify({ ...printer, challenge: undefined });
    expect(state.challengeState.value).toBe('metadata-missing');
    expect(api.confirm).not.toHaveBeenCalled();

    await state.load();
    state.openVerify(state.devices.value[0]!);
    state.verifyForm.value = {
      challengeId: challenge.challengeId,
      code: '123456',
      operationPassword: 're-entered-secret',
    };
    api.confirm.mockResolvedValueOnce({ printer: activePrinter });
    await state.retryOperation('confirm', printer.id);

    expect(api.confirm).toHaveBeenCalledWith(
      printer.id,
      {
        challengeId: challenge.challengeId,
        code: '123456',
        operationPassword: 're-entered-secret',
      },
      UUIDS[0],
    );
  });

  it('ignores an older list response and an older operation response that resolve last', async () => {
    const staleList = deferred<CloudPrinterListResult>();
    const currentList = deferred<CloudPrinterListResult>();
    api.list
      .mockReturnValueOnce(staleList.promise)
      .mockReturnValueOnce(currentList.promise);
    const state = createState();
    const firstLoad = state.load();
    const secondLoad = state.load();
    currentList.resolve({ ...listResult, items: [activePrinter] });
    await secondLoad;
    staleList.resolve(listResult);
    await firstLoad;
    expect(state.devices.value).toEqual([activePrinter]);

    const staleRename = deferred<{ printer: CloudPrinterView }>();
    const currentRename = deferred<{ printer: CloudPrinterView }>();
    api.rename
      .mockReturnValueOnce(staleRename.promise)
      .mockReturnValueOnce(currentRename.promise);
    api.list.mockResolvedValue({
      ...listResult,
      items: [{ ...activePrinter, displayName: '新名字' }],
    });
    state.renameForm.value = { displayName: '旧名字' };
    const firstRename = state.rename(printer.id);
    state.renameForm.value = { displayName: '新名字' };
    const secondRename = state.rename(printer.id);
    currentRename.resolve({
      printer: { ...activePrinter, displayName: '新名字' },
    });
    await secondRename;
    staleRename.resolve({
      printer: { ...activePrinter, displayName: '旧名字' },
    });
    await firstRename;

    expect(state.devices.value[0]?.displayName).toBe('新名字');
    expect(state.pendingOperations.value).toEqual([]);
  });

  it('fences a list started before authoritative rename success and applies its reload', async () => {
    const staleList = deferred<CloudPrinterListResult>();
    api.list.mockReturnValueOnce(staleList.promise).mockResolvedValueOnce({
      ...listResult,
      items: [{ ...activePrinter, displayName: '权威新名字' }],
    });
    api.rename.mockResolvedValueOnce({
      printer: { ...activePrinter, displayName: 'mutation 临时名字' },
    });
    const state = createState();
    const loading = state.load();
    state.renameForm.value = { displayName: '权威新名字' };

    await state.rename(printer.id);
    staleList.resolve(listResult);
    await loading;

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(state.devices.value[0]?.displayName).toBe('权威新名字');
  });

  it.each([networkError(), new ApiClientError(503, '上游响应丢失')])(
    'keeps the successful replacement UI when the replaced operation fails late',
    async (lateError) => {
      const staleRename = deferred<{ printer: CloudPrinterView }>();
      const currentRename = deferred<{ printer: CloudPrinterView }>();
      api.rename
        .mockReturnValueOnce(staleRename.promise)
        .mockReturnValueOnce(currentRename.promise);
      api.list.mockResolvedValue({
        ...listResult,
        items: [{ ...activePrinter, displayName: '新请求名称' }],
      });
      const state = createState();
      state.renameForm.value = { displayName: '旧请求名称' };
      const staleRequest = state.rename(printer.id);
      state.renameForm.value = { displayName: '新请求名称' };
      const currentRequest = state.rename(printer.id);

      currentRename.resolve({
        printer: { ...activePrinter, displayName: '新请求名称' },
      });
      await currentRequest;
      staleRename.reject(lateError);

      await expect(staleRequest).rejects.toBe(lateError);
      expect(api.list).toHaveBeenCalledTimes(1);
      expect(state.devices.value[0]?.displayName).toBe('新请求名称');
      expect(state.pendingOperations.value).toEqual([]);
      expect(state.error.value).toBeNull();
      expect(state.submitting.value).toBe(false);
    },
  );

  it.each([
    ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
    ApiErrorCode.CLOUD_PRINTER_VERIFICATION_EXPIRED,
    ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED,
  ])(
    'releases stable confirm %s, reloads authoritative challenge and preserves the primary error',
    async (code) => {
      const authoritative =
        code === ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED
          ? {
              ...printer,
              status: CloudPrinterStatus.ERROR,
              bindingStage: PrinterBindingStage.RECONCILIATION,
              challenge: undefined,
            }
          : {
              ...printer,
              challenge: {
                ...challenge,
                remainingAttempts: 2,
              },
            };
      api.confirm.mockRejectedValueOnce(
        new ApiClientError(422, '验证码稳定失败', { code }),
      );
      api.list.mockResolvedValueOnce({ ...listResult, items: [authoritative] });
      const state = createState();
      state.openVerify(printer);
      state.verifyForm.value = {
        challengeId: printer.id,
        code: '000000',
        operationPassword: 'secret',
      };

      await expect(state.confirm(printer.id)).rejects.toMatchObject({ code });

      expect(state.pendingOperations.value).toEqual([]);
      expect(api.list).toHaveBeenCalledTimes(1);
      expect(state.devices.value[0]).toEqual(authoritative);
      expect(state.error.value).toMatchObject({
        kind: 'stable',
        message: '验证码稳定失败',
      });
      if (code === ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED) {
        expect(state.challengeState.value).toBe('metadata-missing');
      } else {
        expect(state.remainingAttempts.value).toBe(2);
      }
    },
  );

  it('marks challenge metadata missing when stable confirm reload fails without replacing verification error', async () => {
    api.confirm.mockRejectedValueOnce(
      new ApiClientError(422, '验证码错误', {
        code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
      }),
    );
    api.list.mockRejectedValueOnce(networkError());
    const state = createState();
    state.openVerify(printer);
    state.verifyForm.value = {
      challengeId: printer.id,
      code: '000000',
      operationPassword: 'secret',
    };

    await expect(state.confirm(printer.id)).rejects.toMatchObject({
      code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
    });

    expect(state.error.value).toMatchObject({
      kind: 'stable',
      message: '验证码错误',
    });
    expect(state.challenge.value).toBeNull();
    expect(state.challengeState.value).toBe('metadata-missing');
  });

  it.each([
    ['', '打印机名称不能为空'],
    ['   ', '打印机名称不能为空'],
    ['😀'.repeat(65), '打印机名称最多 64 个字符'],
  ])(
    'rejects invalid rename %j before creating an operation',
    async (name, message) => {
      const state = createState();
      state.renameForm.value = { displayName: name };

      await expect(state.rename(printer.id)).rejects.toThrow(message);

      expect(api.rename).not.toHaveBeenCalled();
      expect(state.pendingOperations.value).toEqual([]);
    },
  );

  it('trims a 64-codepoint Unicode name and never asks for or sends a password', async () => {
    api.rename.mockResolvedValueOnce({
      printer: { ...printer, displayName: '😀'.repeat(64) },
    });
    const state = createState();
    state.renameForm.value = { displayName: `  ${'😀'.repeat(64)}  ` };

    await state.rename(printer.id);

    expect(api.rename).toHaveBeenCalledWith(
      printer.id,
      { displayName: '😀'.repeat(64) },
      UUIDS[0],
    );
    expect(JSON.stringify(api.rename.mock.calls)).not.toContain('password');
  });
});
