import {
  AdminPermission,
  AdminRole,
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  OPERATOR_PERMISSIONS,
  PrinterBindingStage,
  VendorRelationState,
  type AdminSessionView,
  type CloudPrinterListResult,
  type CloudPrinterView,
} from '@bake-mall/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../utils/api-client.js';
import { createAdminSessionStore } from '../../utils/admin-session.js';
import {
  PRINTING_DEVICES_STORAGE_KEY,
  createPrintingDevicesController,
  type PrintingDevicesApi,
  type PrintingDevicesStorage,
} from './printing-devices.js';

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
  challengeId: 'challenge-1001',
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
  challenge,
};
const activePrinter: CloudPrinterView = {
  ...printer,
  status: CloudPrinterStatus.ACTIVE,
  onlineStatus: CloudPrinterOnlineStatus.ONLINE,
  bindingStage: PrinterBindingStage.NONE,
  challenge: undefined,
};
const listResult: CloudPrinterListResult = {
  items: [printer],
  total: 1,
  page: 1,
  pageSize: 20,
};

function token(adminId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: adminId, aud: 'mall-admin' }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

function session(adminId = '42'): AdminSessionView {
  return {
    accessToken: token(adminId),
    expiresAt: '2099-01-01T00:00:00.000Z',
    role: AdminRole.OPERATOR,
    permissions: OPERATOR_PERMISSIONS,
    mustChangePassword: false,
  };
}

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function storageHarness(initial?: unknown) {
  let value = initial;
  const storage: PrintingDevicesStorage = {
    get: vi.fn(() => value),
    remove: vi.fn(() => {
      value = undefined;
    }),
    set: vi.fn((_key, next) => {
      value = next;
    }),
  };
  return { storage, value: () => value };
}

function apiHarness(): PrintingDevicesApi {
  return {
    list: vi.fn().mockResolvedValue(listResult),
    bind: vi.fn(),
    confirm: vi.fn(),
    resend: vi.fn(),
    refresh: vi.fn(),
    requery: vi.fn(),
    confirmDeletion: vi.fn(),
    unbind: vi.fn(),
    rename: vi.fn(),
  };
}

function controllerHarness(initial?: unknown, admin = session()) {
  const adminSession = createAdminSessionStore();
  adminSession.set(admin);
  const api = apiHarness();
  const persisted = storageHarness(initial);
  const randomUUID = vi.fn();
  UUIDS.forEach((uuid) => randomUUID.mockReturnValueOnce(uuid));
  const controller = createPrintingDevicesController({
    adminSession,
    api,
    storage: persisted.storage,
    randomUUID,
    now: () => Date.parse('2026-08-09T10:00:00.000Z'),
  });
  return { adminSession, api, controller, persisted, randomUUID };
}

function timeout(): ApiClientError {
  return new ApiClientError(0, '网络异常');
}

function unknown(): ApiClientError {
  return new ApiClientError(409, '结果未知', {
    code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
  });
}

beforeEach(() => vi.restoreAllMocks());

describe('printing device idempotency and storage', () => {
  const cases = [
    {
      operation: 'bind' as const,
      resourceId: undefined,
      prime(controller: ReturnType<typeof controllerHarness>['controller']) {
        controller.setBindForm({
          serialNumber: 'SN-1001',
          displayName: '前台出单机',
          operationPassword: 'secret',
        });
      },
      start(controller: ReturnType<typeof controllerHarness>['controller']) {
        return controller.bind();
      },
      api(api: PrintingDevicesApi) {
        return vi.mocked(api.bind);
      },
      success: { printer, challenge },
    },
    {
      operation: 'confirm' as const,
      resourceId: printer.id,
      prime(controller: ReturnType<typeof controllerHarness>['controller']) {
        controller.openVerify(printer);
        controller.setVerifyForm({
          code: '123456',
          operationPassword: 'secret',
        });
      },
      start(controller: ReturnType<typeof controllerHarness>['controller']) {
        return controller.confirm(printer.id);
      },
      api(api: PrintingDevicesApi) {
        return vi.mocked(api.confirm);
      },
      success: { printer: activePrinter },
    },
    {
      operation: 'resend' as const,
      resourceId: printer.id,
      prime(controller: ReturnType<typeof controllerHarness>['controller']) {
        controller.setRecoveryPassword('secret');
      },
      start(controller: ReturnType<typeof controllerHarness>['controller']) {
        return controller.resend(printer.id);
      },
      api(api: PrintingDevicesApi) {
        return vi.mocked(api.resend);
      },
      success: { printer, challenge },
    },
    {
      operation: 'refresh' as const,
      resourceId: printer.id,
      prime() {},
      start(controller: ReturnType<typeof controllerHarness>['controller']) {
        return controller.refreshOnlineStatus(printer.id);
      },
      api(api: PrintingDevicesApi) {
        return vi.mocked(api.refresh);
      },
      success: { printer: activePrinter },
    },
    {
      operation: 'requery' as const,
      resourceId: printer.id,
      prime(controller: ReturnType<typeof controllerHarness>['controller']) {
        controller.setRecoveryPassword('secret');
      },
      start(controller: ReturnType<typeof controllerHarness>['controller']) {
        return controller.requery(printer.id);
      },
      api(api: PrintingDevicesApi) {
        return vi.mocked(api.requery);
      },
      success: { printer: activePrinter },
    },
    {
      operation: 'delete-confirm' as const,
      resourceId: printer.id,
      prime(controller: ReturnType<typeof controllerHarness>['controller']) {
        controller.setRecoveryPassword('secret');
      },
      start(controller: ReturnType<typeof controllerHarness>['controller']) {
        return controller.confirmDeletion(printer.id);
      },
      api(api: PrintingDevicesApi) {
        return vi.mocked(api.confirmDeletion);
      },
      success: { printer: activePrinter },
    },
    {
      operation: 'unbind' as const,
      resourceId: printer.id,
      prime(controller: ReturnType<typeof controllerHarness>['controller']) {
        controller.setRecoveryPassword('secret');
      },
      start(controller: ReturnType<typeof controllerHarness>['controller']) {
        return controller.unbind(printer.id);
      },
      api(api: PrintingDevicesApi) {
        return vi.mocked(api.unbind);
      },
      success: { printer: { ...activePrinter, status: CloudPrinterStatus.UNBOUND } },
    },
    {
      operation: 'rename' as const,
      resourceId: printer.id,
      prime(controller: ReturnType<typeof controllerHarness>['controller']) {
        controller.setRenameName('新名字');
      },
      start(controller: ReturnType<typeof controllerHarness>['controller']) {
        return controller.rename(printer.id);
      },
      api(api: PrintingDevicesApi) {
        return vi.mocked(api.rename);
      },
      success: { printer: { ...activePrinter, displayName: '新名字' } },
    },
  ] as const;

  it.each(cases)(
    '$operation keeps one lowercase UUID through retry/unknown and releases it only on success',
    async (testCase) => {
      const harness = controllerHarness();
      testCase.prime(harness.controller);
      const method = testCase.api(harness.api);
      method.mockRejectedValueOnce(timeout());

      await expect(testCase.start(harness.controller)).rejects.toThrow();
      const firstKey = method.mock.calls[0]?.at(-1);
      expect(firstKey).toBe(UUIDS[0]);
      expect(harness.controller.snapshot().operations).toContainEqual(
        expect.objectContaining({
          operation: testCase.operation,
          ...(testCase.resourceId ? { resourceId: testCase.resourceId } : {}),
          idempotencyKey: UUIDS[0],
          status: 'RETRYABLE',
        }),
      );

      method.mockRejectedValueOnce(unknown());
      await expect(
        harness.controller.continueOperation(
          testCase.operation,
          testCase.resourceId,
        ),
      ).rejects.toThrow();
      expect(method.mock.calls[1]?.at(-1)).toBe(UUIDS[0]);
      expect(harness.controller.snapshot().operations[0]?.status).toBe(
        'UNKNOWN',
      );

      method.mockResolvedValueOnce(testCase.success as never);
      await harness.controller.continueOperation(
        testCase.operation,
        testCase.resourceId,
      );
      expect(method.mock.calls[2]?.at(-1)).toBe(UUIDS[0]);
      expect(harness.controller.snapshot().operations).toEqual([]);

      testCase.prime(harness.controller);
      method.mockResolvedValueOnce(testCase.success as never);
      await testCase.start(harness.controller);
      expect(method.mock.calls[3]?.at(-1)).toBe(UUIDS[1]);
    },
  );

  it('releases an uncertain key and marks stable business failures as FAILED', async () => {
    const errors = [
      ApiErrorCode.IDEMPOTENCY_CONFLICT,
      ApiErrorCode.CLOUD_PRINTER_NAME_INVALID,
      ApiErrorCode.ADMIN_VERIFICATION_FAILED,
      ApiErrorCode.ADMIN_PERMISSION_DENIED,
    ];

    await Promise.all(
      errors.map(async (code) => {
        const harness = controllerHarness();
        harness.controller.setRenameName('新名字');
        vi.mocked(harness.api.rename)
          .mockRejectedValueOnce(timeout())
          .mockRejectedValueOnce(new ApiClientError(409, 'terminal', { code }));
        await expect(harness.controller.rename(printer.id)).rejects.toThrow();
        await expect(
          harness.controller.continueOperation('rename', printer.id),
        ).rejects.toThrow();
        expect(harness.controller.snapshot().operations).toEqual([]);
        expect(harness.controller.snapshot().error).toBe('terminal');
      }),
    );
  });

  it('reuses the pending refresh key for direct refresh calls until it stabilizes', async () => {
    const harness = controllerHarness();
    const refresh = vi.mocked(harness.api.refresh);
    refresh.mockRejectedValueOnce(timeout()).mockRejectedValueOnce(unknown());

    await expect(
      harness.controller.refreshOnlineStatus(printer.id),
    ).rejects.toThrow();
    const originalKey = refresh.mock.calls[0]?.at(-1);
    await expect(
      harness.controller.refreshOnlineStatus(printer.id),
    ).rejects.toThrow();

    expect(refresh.mock.calls.map((call) => call.at(-1))).toEqual([
      originalKey,
      originalKey,
    ]);
    expect(harness.controller.snapshot().operations[0]?.idempotencyKey).toBe(
      originalKey,
    );

    refresh.mockResolvedValueOnce({ printer: activePrinter });
    await harness.controller.continueOperation('refresh', printer.id);
    expect(harness.controller.snapshot().operations).toEqual([]);

    refresh.mockResolvedValueOnce({ printer: activePrinter });
    await harness.controller.refreshOnlineStatus(printer.id);
    expect(refresh.mock.calls.at(-1)?.at(-1)).not.toBe(originalKey);
  });

  it('clears re-entered bind, confirm, and recovery secrets immediately when continuing hydrated operations', async () => {
    const bindPending = deferred<{
      printer: CloudPrinterView;
      challenge: typeof challenge;
    }>();
    const bindHarness = controllerHarness({
      adminId: '42',
      pendingDeviceOperations: [
        { operation: 'bind', idempotencyKey: UUIDS[0] },
      ],
    });
    bindHarness.controller.setBindForm({
      serialNumber: 'SN-REENTERED',
      displayName: '前台出单机',
      operationPassword: 'bind-secret',
    });
    vi.mocked(bindHarness.api.bind).mockReturnValueOnce(bindPending.promise);

    const binding = bindHarness.controller.continueOperation('bind');

    expect(bindHarness.controller.snapshot().forms.bind).toEqual({
      serialNumber: '',
      displayName: '前台出单机',
      operationPassword: '',
    });
    bindPending.resolve({ printer, challenge });
    await binding;

    const confirmPending = deferred<{ printer: CloudPrinterView }>();
    const confirmHarness = controllerHarness({
      adminId: '42',
      pendingDeviceOperations: [
        {
          operation: 'confirm',
          resourceId: printer.id,
          idempotencyKey: UUIDS[1],
        },
      ],
    });
    confirmHarness.controller.openVerify(printer);
    confirmHarness.controller.setVerifyForm({
      code: '123456',
      operationPassword: 'confirm-secret',
    });
    vi.mocked(confirmHarness.api.confirm).mockReturnValueOnce(
      confirmPending.promise,
    );

    const confirming = confirmHarness.controller.continueOperation(
      'confirm',
      printer.id,
    );

    expect(confirmHarness.controller.snapshot().forms.verify).toEqual({
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
    const resendHarness = controllerHarness({
      adminId: '42',
      pendingDeviceOperations: [
        {
          operation: 'resend',
          resourceId: printer.id,
          idempotencyKey: UUIDS[2],
        },
      ],
    });
    resendHarness.controller.setRecoveryPassword('recovery-secret');
    vi.mocked(resendHarness.api.resend).mockReturnValueOnce(
      resendPending.promise,
    );

    const resending = resendHarness.controller.continueOperation(
      'resend',
      printer.id,
    );

    expect(resendHarness.controller.snapshot().forms.recoveryPassword).toBe('');
    resendPending.resolve({ printer, challenge });
    await resending;
  });

  it('persists the exact whitelist, hydrates without replay, and clears on logout/admin mismatch', () => {
    const initial = {
      adminId: '42',
      lastPrinterId: printer.id,
      pendingDeviceOperations: [
        {
          operation: 'refresh',
          resourceId: printer.id,
          idempotencyKey: UUIDS[0],
        },
      ],
    };
    const harness = controllerHarness(initial);

    expect(harness.controller.snapshot().operations).toMatchObject([
      { operation: 'refresh', status: 'UNKNOWN' },
    ]);
    expect(harness.controller.snapshot().manualContinueRequired).toBe(true);
    expect(harness.api.refresh).not.toHaveBeenCalled();
    harness.controller.persistLifecycleState();
    expect(harness.persisted.value()).toEqual(initial);
    expect(JSON.stringify(harness.persisted.value())).not.toMatch(
      /token|serialNumber|displayName|password|code|challenge|address|phone/i,
    );

    harness.adminSession.clear();
    harness.controller.syncAdminIdentity();
    expect(harness.persisted.storage.remove).toHaveBeenCalledWith(
      PRINTING_DEVICES_STORAGE_KEY,
    );
    expect(harness.controller.snapshot().operations).toEqual([]);

    const mismatch = controllerHarness(initial, session('84'));
    expect(mismatch.controller.snapshot().operations).toEqual([]);
    expect(mismatch.persisted.storage.remove).toHaveBeenCalled();
  });

  it('clears hydrated operations when the in-memory admin changes after creation', () => {
    const harness = controllerHarness({
      adminId: '42',
      pendingDeviceOperations: [
        {
          operation: 'refresh',
          resourceId: printer.id,
          idempotencyKey: UUIDS[0],
        },
      ],
    });

    harness.adminSession.set(session('84'));
    expect(harness.controller.authorized()).toBe(true);

    expect(harness.controller.snapshot().operations).toEqual([]);
    expect(harness.persisted.storage.remove).toHaveBeenCalledWith(
      PRINTING_DEVICES_STORAGE_KEY,
    );
  });

  it.each([
    ['missing', listResult],
    [printer.id, listResult],
  ])(
    'clears lastPrinterId %s when the authoritative list has no matching active printer',
    async (lastPrinterId, result) => {
      const harness = controllerHarness({
        adminId: '42',
        lastPrinterId,
        pendingDeviceOperations: [],
      });
      vi.mocked(harness.api.list).mockResolvedValueOnce(result);

      await harness.controller.load();
      harness.controller.persistLifecycleState();

      expect(harness.persisted.value()).toEqual({
        adminId: '42',
        pendingDeviceOperations: [],
      });
    },
  );

  it('does not replace the last selected printer ID after a device-management operation', async () => {
    const pendingPrinter = {
      ...printer,
      id: '1002',
      displayName: '待验证设备',
    };
    const harness = controllerHarness({
      adminId: '42',
      lastPrinterId: activePrinter.id,
      pendingDeviceOperations: [],
    });
    harness.controller.setRenameName('待验证设备');
    vi.mocked(harness.api.rename).mockResolvedValueOnce({
      printer: pendingPrinter,
    });
    vi.mocked(harness.api.list).mockResolvedValueOnce({
      ...listResult,
      items: [activePrinter, pendingPrinter],
      total: 2,
    });

    await harness.controller.rename(pendingPrinter.id);
    harness.controller.persistLifecycleState();

    expect(harness.persisted.value()).toEqual({
      adminId: '42',
      lastPrinterId: activePrinter.id,
      pendingDeviceOperations: [],
    });
  });
});

describe('challenge, fencing, actions, and validation', () => {
  it('clears sensitive forms before submit and restores per-printer challenge countdown metadata', async () => {
    const bindPending = deferred<{
      printer: CloudPrinterView;
      challenge: typeof challenge;
    }>();
    const harness = controllerHarness();
    vi.mocked(harness.api.bind).mockReturnValueOnce(bindPending.promise);
    harness.controller.setBindForm({
      serialNumber: 'SN-1001',
      displayName: '前台出单机',
      operationPassword: 'secret',
    });

    const binding = harness.controller.bind();
    expect(harness.controller.snapshot().forms.bind).toEqual({
      serialNumber: '',
      displayName: '前台出单机',
      operationPassword: '',
    });
    bindPending.resolve({ printer, challenge });
    await binding;
    expect(harness.controller.snapshot()).toMatchObject({
      challengeByPrinterId: { '1001': challenge },
      countdownSeconds: 300,
      remainingAttempts: 3,
    });

    harness.controller.openVerify(printer);
    harness.controller.setVerifyForm({
      code: '123456',
      operationPassword: 'verify-secret',
    });
    vi.mocked(harness.api.confirm).mockResolvedValueOnce({
      printer: activePrinter,
    });
    const confirming = harness.controller.confirm(printer.id);
    expect(harness.controller.snapshot().forms.verify).toEqual({
      challengeId: challenge.challengeId,
      code: '',
      operationPassword: '',
    });
    await confirming;
  });

  it('never carries challenge A into B and reloads authoritative metadata after stable verify failures', async () => {
    const printerB = {
      ...printer,
      id: '1002',
      challenge: {
        ...challenge,
        challengeId: 'challenge-1002',
        remainingAttempts: 2,
      },
    };
    const harness = controllerHarness();
    vi.mocked(harness.api.list).mockResolvedValue({
      ...listResult,
      items: [printer, printerB],
      total: 2,
    });
    await harness.controller.load();
    harness.controller.openVerify(printerB);
    expect(harness.controller.snapshot().forms.verify.challengeId).toBe(
      'challenge-1002',
    );

    harness.controller.setVerifyForm({
      code: '000000',
      operationPassword: 'secret',
    });
    vi.mocked(harness.api.confirm).mockRejectedValueOnce(
      new ApiClientError(422, '验证码错误', {
        code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
      }),
    );
    await expect(harness.controller.confirm(printerB.id)).rejects.toThrow();
    expect(harness.api.list).toHaveBeenCalledTimes(2);
    expect(harness.controller.snapshot().remainingAttempts).toBe(2);
  });

  it('converges the fifth failed verification to exhausted and prevents another confirm', async () => {
    const exhaustedPrinter: CloudPrinterView = {
      ...printer,
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      challenge: undefined,
    };
    const harness = controllerHarness();
    vi.mocked(harness.api.list).mockResolvedValueOnce({
      ...listResult,
      items: [exhaustedPrinter],
    });
    harness.controller.openVerify({
      ...printer,
      challenge: { ...challenge, remainingAttempts: 1 },
    });
    harness.controller.setVerifyForm({
      code: '000000',
      operationPassword: 'secret',
    });
    vi.mocked(harness.api.confirm).mockRejectedValueOnce(
      new ApiClientError(422, '验证码尝试次数已耗尽', {
        code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED,
      }),
    );

    await expect(harness.controller.confirm(printer.id)).rejects.toThrow(
      '验证码尝试次数已耗尽',
    );

    expect(harness.controller.snapshot()).toMatchObject({
      devices: [exhaustedPrinter],
      remainingAttempts: 0,
    });
    expect(harness.controller.snapshot().forms.verify.challengeId).toBe('');
    expect(() => harness.controller.confirm(printer.id)).toThrow(
      '验证码信息缺失，请先刷新列表',
    );
    expect(harness.api.confirm).toHaveBeenCalledTimes(1);
  });

  it('shows authoritative OFFLINE status while keeping refresh available', async () => {
    const offlinePrinter: CloudPrinterView = {
      ...activePrinter,
      onlineStatus: CloudPrinterOnlineStatus.OFFLINE,
    };
    const harness = controllerHarness();
    vi.mocked(harness.api.list).mockResolvedValueOnce({
      ...listResult,
      items: [offlinePrinter],
    });

    await harness.controller.load();

    expect(harness.controller.snapshot().devices).toEqual([offlinePrinter]);
    expect(harness.controller.actionsFor(offlinePrinter)).toContain('refresh');
  });

  it('fences stale lists and stale mutations', async () => {
    const staleList = deferred<CloudPrinterListResult>();
    const currentList = deferred<CloudPrinterListResult>();
    const harness = controllerHarness();
    vi.mocked(harness.api.list)
      .mockReturnValueOnce(staleList.promise)
      .mockReturnValueOnce(currentList.promise);
    const first = harness.controller.load();
    const second = harness.controller.load();
    currentList.resolve({ ...listResult, items: [activePrinter] });
    await second;
    staleList.resolve(listResult);
    await first;
    expect(harness.controller.snapshot().devices).toEqual([activePrinter]);

    const pendingRename = deferred<{ printer: CloudPrinterView }>();
    vi.mocked(harness.api.rename).mockReturnValueOnce(pendingRename.promise);
    vi.mocked(harness.api.list).mockResolvedValue({
      ...listResult,
      items: [{ ...activePrinter, displayName: '旧名字' }],
    });
    harness.controller.setRenameName('旧名字');
    const firstMutation = harness.controller.rename(printer.id);
    harness.controller.setRenameName('新名字');

    await expect(harness.controller.rename(printer.id)).rejects.toThrow(
      '正在准备或等待恢复',
    );
    expect(harness.api.rename).toHaveBeenCalledTimes(1);
    pendingRename.resolve({
      printer: { ...activePrinter, displayName: '旧名字' },
    });
    await firstMutation;
    expect(harness.controller.snapshot().devices[0]?.displayName).toBe(
      '旧名字',
    );
  });

  it('uses the approved action matrix and exposes unbind only for ACTIVE', () => {
    const harness = controllerHarness();
    expect(harness.controller.actionsFor(printer)).toEqual([
      'verify',
      'resend',
      'rename',
    ]);
    expect(harness.controller.actionsFor(activePrinter)).toEqual([
      'refresh',
      'unbind',
      'rename',
    ]);
    expect(
      harness.controller.actionsFor({
        ...printer,
        status: CloudPrinterStatus.ERROR,
        bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
      }),
    ).toEqual(['delete-confirm', 'rename']);
    expect(
      harness.controller.actionsFor({
        ...printer,
        status: CloudPrinterStatus.ERROR,
        bindingStage: PrinterBindingStage.UNBIND_DELETE,
      }),
    ).toEqual(['delete-confirm', 'rename']);
    expect(
      harness.controller.actionsFor({
        ...printer,
        status: CloudPrinterStatus.UNBINDING,
        bindingStage: PrinterBindingStage.UNBIND_DELETE,
      }),
    ).toEqual(['rename']);
    expect(harness.controller.actionsFor(printer)).not.toContain('unbind');
  });

  it('validates trimmed Unicode rename at 1-64 codepoints without password', async () => {
    const harness = controllerHarness();
    harness.controller.setRenameName('😀'.repeat(65));
    await expect(harness.controller.rename(printer.id)).rejects.toThrow(
      '打印机名称最多 64 个字符',
    );
    harness.controller.setRenameName(`  ${'😀'.repeat(64)}  `);
    vi.mocked(harness.api.rename).mockResolvedValueOnce({
      printer: { ...activePrinter, displayName: '😀'.repeat(64) },
    });
    await harness.controller.rename(printer.id);
    expect(harness.api.rename).toHaveBeenCalledWith(
      printer.id,
      { displayName: '😀'.repeat(64) },
      UUIDS[0],
    );
    expect(
      JSON.stringify(vi.mocked(harness.api.rename).mock.calls),
    ).not.toContain('password');
  });

  it('rejects sessions without PRINT_DEVICE_MANAGE and clears revoked sessions', async () => {
    const denied = session() as Extract<
      AdminSessionView,
      { mustChangePassword: false }
    >;
    const harness = controllerHarness(
      {
        adminId: '42',
        pendingDeviceOperations: [],
      },
      {
        ...denied,
        permissions: [
          AdminPermission.USER_READ,
        ] as unknown as typeof denied.permissions,
      },
    );
    expect(harness.controller.authorized()).toBe(false);
    expect(harness.adminSession.get()).toBeNull();
    expect(harness.persisted.storage.remove).toHaveBeenCalled();
  });
});
