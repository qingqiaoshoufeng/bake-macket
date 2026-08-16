import {
  AdminRole,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  FulfillmentType,
  OPERATOR_PERMISSIONS,
  OrderStatus,
  ManualPrintResolution,
  PrintBatchStatus,
  PrintJobStatus,
  type AdminOrderListItem,
  type AdminSessionView,
  type CloudPrinterView,
  type PrintJobListResult,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createAdminSessionStore } from '../../utils/admin-session.js';
import {
  PRINTING_ORDERS_STORAGE_KEY,
  createPrintingOrdersController,
} from './printing-orders.js';

const NOW = '2026-08-13T01:00:00.000Z';
const ADMIN_ID = '42';
const ADMIN_STORAGE_KEY = `${PRINTING_ORDERS_STORAGE_KEY}:${ADMIN_ID}`;
const session: AdminSessionView = {
  accessToken: `header.${Buffer.from(
    JSON.stringify({ sub: ADMIN_ID, aud: 'mall-admin' }),
  ).toString('base64url')}.signature`,
  expiresAt: '2099-01-01T00:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};
const order: AdminOrderListItem = {
  id: '9',
  orderNo: 'BM9',
  userId: '1',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '林女士',
  contactPhone: '138****0000',
  itemLineCount: 1,
  totalQuantity: 1,
  goodsTotalCents: 1000,
  membershipDiscountCents: 0,
  creditAppliedCents: 0,
  payableTotalCents: 1000,
  createdAt: NOW,
  updatedAt: NOW,
};
const printer: CloudPrinterView = {
  id: '4',
  displayName: '测试打印机',
  serialNumberMasked: 'FA****01',
  status: CloudPrinterStatus.ACTIVE,
  onlineStatus: CloudPrinterOnlineStatus.ONLINE,
  lastStatusCheckedAt: NOW,
  isCurrent: true,
};

function setup() {
  const adminSession = createAdminSessionStore();
  let persisted: unknown;
  let currentNow = Date.parse(NOW) + 10_000;
  const storage = {
    get: vi.fn(() => persisted),
    remove: vi.fn(() => {
      persisted = undefined;
    }),
    set: vi.fn((_key: string, value: unknown) => {
      persisted = value;
    }),
  };
  adminSession.set(session);
  const batch = {
    id: '7',
    printerId: '4',
    createdByAdminId: '1',
    status: PrintBatchStatus.COMPLETED,
    totalCount: 1,
    classifiedCount: 1,
    pendingCount: 0,
    submittingCount: 0,
    acceptedCount: 1,
    failedCount: 0,
    unknownCount: 0,
    manualReviewCount: 0,
    manuallyResolvedCount: 0,
    cancelledCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const api = {
    listOrders: vi.fn(async () => ({
      items: [order],
      page: 1,
      pageSize: 20,
      total: 1,
    })),
    listPrinters: vi.fn(async () => ({
      items: [printer],
      page: 1,
      pageSize: 100,
      total: 1,
    })),
    getCurrentPrinter: vi.fn(async () => ({
      printer,
      revision: 1,
      updatedAt: NOW,
    })),
    createSingle: vi.fn(async () => ({
      batch,
      job: {
        id: '20',
        batchId: '7',
        orderId: '9',
        printerId: '4',
        sequence: 1,
        status: PrintJobStatus.ACCEPTED,
        vendorJobId: 'FAKE-ORDER-1',
        vendorErrorCode: null,
        acceptedAt: NOW,
        createdByAdminId: '1',
        manualResolution: null,
        manualResolutionByAdminId: null,
        manualResolutionAt: null,
        supersedesJobId: null,
        payloadRedactedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    })),
    createBatch: vi.fn(),
    appendBatch: vi.fn(),
    sealBatch: vi.fn(),
    processBatch: vi.fn(async () => ({
      batch,
      processedCount: 0,
      accepted: 0,
      failed: 0,
      unknown: 0,
      manualReview: 0,
    })),
    listJobs: vi.fn(async (): Promise<PrintJobListResult> => ({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    })),
    queryUnknown: vi.fn(),
    retryFailed: vi.fn(),
    resolveManual: vi.fn(),
  };
  const controller = createPrintingOrdersController({
    adminSession,
    api: api as never,
    randomUUID: () => '12345678-1234-4234-9234-123456789abc',
    now: () => currentNow,
    storage,
  });
  return {
    controller,
    api,
    adminSession,
    storage,
    persisted: () => persisted,
    setNow: (value: number) => {
      currentNow = value;
    },
  };
}

describe('printing orders controller', () => {
  it('loads orders, all printers, current, and available printers in parallel', async () => {
    const { controller, api } = setup();
    const offline = {
      ...printer,
      id: '5',
      isCurrent: false,
      onlineStatus: CloudPrinterOnlineStatus.OFFLINE,
    };
    const stale = {
      ...printer,
      id: '6',
      isCurrent: false,
      lastStatusCheckedAt: '2026-08-13T00:59:00.000Z',
    };
    api.listPrinters.mockResolvedValueOnce({
      items: [printer, offline, stale],
      page: 1,
      pageSize: 100,
      total: 3,
    });

    const loading = controller.load();

    expect(api.listOrders).toHaveBeenCalledTimes(1);
    expect(api.listPrinters).toHaveBeenCalledTimes(1);
    expect(api.getCurrentPrinter).toHaveBeenCalledTimes(1);
    await loading;
    expect(controller.snapshot()).toMatchObject({
      orders: [{ id: '9' }],
      printers: [{ id: '4' }, { id: '5' }, { id: '6' }],
      availablePrinters: [{ id: '4' }],
      current: { printer: { id: '4' }, revision: 1 },
      selectedPrinterId: '4',
      selectionSource: 'current',
    });
  });

  it('loads more than 100 printers across pages and selects the only eligible printer on page 2', async () => {
    const { controller, api } = setup();
    const unavailable = Array.from({ length: 100 }, (_, index) => ({
      ...printer,
      id: String(index + 1),
      isCurrent: false,
      onlineStatus: CloudPrinterOnlineStatus.OFFLINE,
    }));
    const eligible = {
      ...printer,
      id: '101',
      displayName: '第二页打印机',
      isCurrent: false,
    };
    api.listPrinters
      .mockResolvedValueOnce({
        items: unavailable,
        page: 1,
        pageSize: 100,
        total: 101,
      })
      .mockResolvedValueOnce({
        items: [eligible],
        page: 2,
        pageSize: 100,
        total: 101,
      });
    api.getCurrentPrinter.mockResolvedValueOnce({
      printer: null,
      revision: 3,
      updatedAt: NOW,
    } as never);

    await controller.load();

    expect(api.listPrinters).toHaveBeenNthCalledWith(1, { page: 1, pageSize: 100 });
    expect(api.listPrinters).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 100 });
    expect(controller.snapshot()).toMatchObject({
      printers: expect.arrayContaining([expect.objectContaining({ id: '101' })]),
      availablePrinters: [{ id: '101' }],
      selectedPrinterId: '101',
      selectionSource: 'single-available',
    });
  });

  it('requires manual choice when eligible printers span multiple pages', async () => {
    const { controller, api } = setup();
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...printer,
      id: String(index + 1),
      isCurrent: false,
      onlineStatus:
        index === 99
          ? CloudPrinterOnlineStatus.ONLINE
          : CloudPrinterOnlineStatus.OFFLINE,
    }));
    const secondEligible = {
      ...printer,
      id: '101',
      displayName: '第二页打印机',
      isCurrent: false,
    };
    api.listPrinters
      .mockResolvedValueOnce({
        items: firstPage,
        page: 1,
        pageSize: 100,
        total: 101,
      })
      .mockResolvedValueOnce({
        items: [secondEligible],
        page: 2,
        pageSize: 100,
        total: 101,
      });
    api.getCurrentPrinter.mockResolvedValueOnce({
      printer: null,
      revision: 3,
      updatedAt: NOW,
    } as never);

    await controller.load();

    expect(controller.snapshot()).toMatchObject({
      availablePrinters: [
        expect.objectContaining({ id: '100' }),
        expect.objectContaining({ id: '101' }),
      ],
      selectedPrinterId: null,
      selectionSource: null,
    });
    expect(controller.snapshot().selectionMessage).toContain('请明确选择');
  });

  it('rejects abnormal printer pagination instead of looping forever', async () => {
    const { controller, api } = setup();
    api.listPrinters.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, index) => ({
        ...printer,
        id: String(index + 1),
      })),
      page: 1,
      pageSize: 100,
      total: 20_000,
    });

    await expect(controller.load()).rejects.toThrow('分页响应异常');
    expect(api.listPrinters.mock.calls.length).toBeLessThanOrEqual(100);
    expect(controller.snapshot()).toMatchObject({
      loadSucceeded: false,
      selectionReady: false,
    });
  });

  it.each([
    {
      name: 'offline',
      current: { onlineStatus: CloudPrinterOnlineStatus.OFFLINE },
      reason: '离线',
    },
    {
      name: 'abnormal',
      current: { onlineStatus: CloudPrinterOnlineStatus.ABNORMAL },
      reason: '状态异常',
    },
    {
      name: 'stale',
      current: { lastStatusCheckedAt: '2026-08-13T00:59:00.000Z' },
      reason: '状态已过期',
    },
    {
      name: 'not active',
      current: { status: CloudPrinterStatus.ERROR },
      reason: '未处于 ACTIVE',
    },
  ])('does not fall back when current is $name', async ({ current, reason }) => {
    const { controller, api } = setup();
    const unavailableCurrent = { ...printer, ...current };
    const other = {
      ...printer,
      id: '5',
      displayName: '后厨打印机',
      isCurrent: false,
    };
    api.listPrinters.mockResolvedValueOnce({
      items: [unavailableCurrent, other],
      page: 1,
      pageSize: 100,
      total: 2,
    });
    api.getCurrentPrinter.mockResolvedValueOnce({
      printer: unavailableCurrent,
      revision: 2,
      updatedAt: NOW,
    });

    await controller.load();

    expect(controller.snapshot()).toMatchObject({
      current: { printer: { id: '4' } },
      availablePrinters: [{ id: '5' }],
      selectedPrinterId: null,
      selectionSource: null,
    });
    expect(controller.snapshot().selectionMessage).toContain(reason);
  });

  it.each([
    { availableCount: 0, expected: null, message: '暂无可用' },
    { availableCount: 1, expected: '4', message: '已自动选择唯一可用设备' },
    { availableCount: 2, expected: null, message: '请明确选择' },
  ])(
    'applies no-current fallback for $availableCount available printers',
    async ({ availableCount, expected, message }) => {
      const { controller, api } = setup();
      const items = [
        { ...printer, isCurrent: false },
        { ...printer, id: '5', displayName: '后厨打印机', isCurrent: false },
      ].slice(0, availableCount);
      api.listPrinters.mockResolvedValueOnce({
        items,
        page: 1,
        pageSize: 100,
        total: items.length,
      });
      api.getCurrentPrinter.mockResolvedValueOnce({
        printer: null,
        revision: 3,
        updatedAt: NOW,
      } as never);

      await controller.load();

      expect(controller.snapshot().selectedPrinterId).toBe(expected);
      expect(controller.snapshot().selectionMessage).toContain(message);
    },
  );

  it('preserves a still-available manual choice across a current switch', async () => {
    const { controller, api } = setup();
    const other = {
      ...printer,
      id: '5',
      displayName: '后厨打印机',
      isCurrent: false,
    };
    api.listPrinters.mockResolvedValue({
      items: [printer, other],
      page: 1,
      pageSize: 100,
      total: 2,
    });
    await controller.load();
    controller.selectPrinter('5');
    api.getCurrentPrinter.mockResolvedValueOnce({
      printer: { ...other, id: '4', isCurrent: true },
      revision: 2,
      updatedAt: NOW,
    });

    await controller.load();

    expect(controller.snapshot()).toMatchObject({
      selectedPrinterId: '5',
      selectionSource: 'manual',
    });
  });

  it('clears an invalidated manual choice without falling back to current', async () => {
    const { controller, api } = setup();
    const manual = {
      ...printer,
      id: '5',
      displayName: '后厨打印机',
      serialNumberMasked: 'FB****02',
      isCurrent: false,
    };
    api.listPrinters.mockResolvedValueOnce({
      items: [printer, manual],
      page: 1,
      pageSize: 100,
      total: 2,
    });
    await controller.load();
    controller.selectPrinter('5');
    api.listPrinters.mockResolvedValueOnce({
      items: [printer, { ...manual, onlineStatus: CloudPrinterOnlineStatus.OFFLINE }],
      page: 1,
      pageSize: 100,
      total: 2,
    });

    await controller.load();

    expect(controller.snapshot()).toMatchObject({
      selectedPrinterId: null,
      selectionSource: 'manual',
      rememberedManualPrinterId: '5',
    });
    expect(controller.snapshot().selectionMessage).toContain('后厨打印机');
    expect(controller.snapshot().selectionMessage).toContain('重新选择');
  });

  it('keeps a restored printer fixed and blocks replay when it is unavailable', async () => {
    const adminSession = createAdminSessionStore();
    adminSession.set(session);
    const { api } = setup();
    const offlineRestored = {
      ...printer,
      onlineStatus: CloudPrinterOnlineStatus.OFFLINE,
    };
    api.listPrinters.mockResolvedValueOnce({
      items: [offlineRestored, { ...printer, id: '5', isCurrent: false }],
      page: 1,
      pageSize: 100,
      total: 2,
    });
    api.getCurrentPrinter.mockResolvedValueOnce({
      printer: { ...printer, id: '5', isCurrent: true },
      revision: 2,
      updatedAt: NOW,
    });
    const controller = createPrintingOrdersController({
      adminSession,
      api: api as never,
      randomUUID: () => '22345678-1234-4234-9234-123456789abc',
      now: () => Date.parse(NOW) + 10_000,
      storage: {
        get: () => ({
          batchId: '',
          pendingOperationKeys: {
            'single:9:4': '12345678-1234-4234-9234-123456789abc',
          },
        }),
        remove: vi.fn(),
        set: vi.fn(),
      },
    });

    await controller.load();

    expect(controller.snapshot()).toMatchObject({
      selectedPrinterId: '4',
      selectionSource: 'restored',
      setupContinueRequired: true,
    });
    expect(controller.snapshot().selectionMessage).toContain('原打印机');
    await expect(controller.submit()).rejects.toThrow('原打印机不可用');
    expect(api.createSingle).not.toHaveBeenCalled();
  });

  it('ignores an older orders/printers/current load generation', async () => {
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
    const { controller, api } = setup();
    const oldOrders = deferred<Awaited<ReturnType<typeof api.listOrders>>>();
    const oldPrinters = deferred<Awaited<ReturnType<typeof api.listPrinters>>>();
    const oldCurrent = deferred<Awaited<ReturnType<typeof api.getCurrentPrinter>>>();
    api.listOrders.mockReturnValueOnce(oldOrders.promise);
    api.listPrinters.mockReturnValueOnce(oldPrinters.promise);
    api.getCurrentPrinter.mockReturnValueOnce(oldCurrent.promise);

    const staleLoad = controller.load();
    await controller.load();
    oldOrders.resolve({ items: [], page: 2, pageSize: 20, total: 0 });
    oldPrinters.resolve({ items: [], page: 1, pageSize: 100, total: 0 });
    oldCurrent.resolve({
      printer: null,
      revision: 0,
      updatedAt: NOW,
    } as never);
    await staleLoad;

    expect(controller.snapshot()).toMatchObject({
      orders: [{ id: '9' }],
      selectedPrinterId: '4',
      current: { printer: { id: '4' } },
      loading: false,
    });
  });

  it('fails the combined load when current cannot be loaded', async () => {
    const { controller, api } = setup();
    api.getCurrentPrinter.mockRejectedValueOnce({
      status: 503,
      message: '当前打印机加载失败',
    });

    await expect(controller.load()).rejects.toThrow('当前打印机加载失败');

    expect(controller.snapshot()).toMatchObject({
      orders: [],
      printers: [],
      availablePrinters: [],
      current: null,
      selectedPrinterId: null,
      loading: false,
      error: '当前打印机加载失败',
    });
  });

  it.each(['listOrders', 'listPrinters', 'getCurrentPrinter'] as const)(
    'fails closed after %s load failure while retaining old display data',
    async (method) => {
      const { controller, api } = setup();
      await controller.load();
      controller.toggleOrder('9');
      api[method].mockRejectedValueOnce({ status: 503, message: `${method} failed` });

      await expect(controller.load()).rejects.toThrow(`${method} failed`);

      expect(controller.snapshot()).toMatchObject({
        orders: [{ id: '9' }],
        printers: [{ id: '4' }],
        loading: false,
        loadSucceeded: false,
        selectionReady: false,
      });
      await expect(controller.submit('4')).rejects.toThrow('请先刷新');
      expect(api.createSingle).not.toHaveBeenCalled();
    },
  );

  it('invalidates the printer snapshot after TTL and requires a successful refresh', async () => {
    const { controller, api, setNow } = setup();
    await controller.load();
    controller.toggleOrder('9');
    setNow(Date.parse(NOW) + 31_000);

    await expect(controller.submit('4')).rejects.toThrow('状态已过期');
    expect(controller.snapshot()).toMatchObject({
      loadSucceeded: false,
      selectionReady: false,
    });
    expect(api.createSingle).not.toHaveBeenCalled();
  });

  it('rejects a stale confirmation intent after the selected printer changes', async () => {
    const { controller, api } = setup();
    const other = { ...printer, id: '5', displayName: '后厨打印机', isCurrent: false };
    api.listPrinters.mockResolvedValueOnce({
      items: [printer, other],
      page: 1,
      pageSize: 100,
      total: 2,
    });
    await controller.load();
    controller.toggleOrder('9');
    const intent = controller.createPrintIntent();
    controller.selectPrinter('5');

    await expect(controller.submit(intent)).rejects.toThrow('打印机选择或状态已变化');
    expect(api.createSingle).not.toHaveBeenCalled();
  });

  it('submits a selected order once and labels ACCEPTED as vendor acceptance', async () => {
    const { controller, api } = setup();
    await controller.load();
    controller.toggleOrder('9');

    const result = await controller.submit();

    expect(result).toMatchObject({ accepted: 1, failed: 0, unknown: 0 });
    expect(api.createSingle).toHaveBeenCalledWith(
      { orderId: '9', printerId: '4' },
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    );
    expect(controller.snapshot().selectedOrderIds).toEqual([]);
    expect(controller.snapshot().result?.jobs).toEqual([
      expect.objectContaining({ id: '20' }),
    ]);
  });

  it('processes only one server chunk and waits for an explicit continue', async () => {
    const { controller, api, storage, persisted } = setup();
    const secondOrder = { ...order, id: '10', orderNo: 'BM10' };
    api.listOrders.mockResolvedValueOnce({
      items: [order, secondOrder],
      page: 1,
      pageSize: 20,
      total: 2,
    });
    const pausedBatch = {
      id: '8',
      printerId: '4',
      createdByAdminId: '1',
      status: PrintBatchStatus.PAUSED,
      totalCount: 25,
      classifiedCount: 20,
      pendingCount: 5,
      submittingCount: 0,
      acceptedCount: 20,
      failedCount: 0,
      unknownCount: 0,
      manualReviewCount: 0,
      manuallyResolvedCount: 0,
      cancelledCount: 0,
      createdAt: NOW,
      updatedAt: NOW,
    };
    api.createBatch.mockResolvedValueOnce({
      batch: { ...pausedBatch, status: PrintBatchStatus.DRAFT },
    });
    api.appendBatch.mockResolvedValueOnce({
      batch: { ...pausedBatch, status: PrintBatchStatus.DRAFT },
      jobs: [],
    });
    api.sealBatch.mockResolvedValueOnce({
      batch: { ...pausedBatch, status: PrintBatchStatus.READY },
    });
    api.processBatch.mockResolvedValueOnce({
      batch: pausedBatch,
      processedCount: 20,
      accepted: 20,
      failed: 0,
      unknown: 0,
      manualReview: 0,
    });

    await controller.load();
    controller.toggleOrder('9');
    controller.toggleOrder('10');
    const result = await controller.submit();

    expect(api.createBatch).toHaveBeenCalledWith(
      { printerId: '4' },
      expect.any(String),
    );
    expect(api.processBatch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      processedCount: 20,
      batch: { id: '8', pendingCount: 5 },
    });
    expect(controller.snapshot().manualContinueRequired).toBe(true);
    expect(controller.snapshot().pendingBatchId).toBe('8');
    expect(persisted()).toEqual({
      batchId: '8',
      pendingOperationKeys: {},
      printerId: '4',
      printerLabel: '测试打印机（FA****01）',
    });
    expect(storage.set).toHaveBeenCalledWith(
      ADMIN_STORAGE_KEY,
      expect.objectContaining({ batchId: '8' }),
    );

    api.processBatch.mockResolvedValueOnce({
      batch: {
        ...pausedBatch,
        status: PrintBatchStatus.COMPLETED,
        classifiedCount: 25,
        pendingCount: 0,
        acceptedCount: 25,
      },
      processedCount: 5,
      accepted: 5,
      failed: 0,
      unknown: 0,
      manualReview: 0,
    });
    await controller.continueBatch();

    expect(api.processBatch).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().manualContinueRequired).toBe(false);
    expect(storage.remove).toHaveBeenCalledWith(ADMIN_STORAGE_KEY);
  });

  it('restores a pre-batch single intent for explicit replay with the same key', () => {
    const adminSession = createAdminSessionStore();
    adminSession.set(session);
    const api = setup().api;
    const controller = createPrintingOrdersController({
      adminSession,
      api: api as never,
      randomUUID: () => '22345678-1234-4234-9234-123456789abc',
      storage: {
        get: () => ({
          batchId: '',
          pendingOperationKeys: {
            'single:9:4': '12345678-1234-4234-9234-123456789abc',
          },
        }),
        remove: vi.fn(),
        set: vi.fn(),
      },
    });

    expect(controller.snapshot()).toMatchObject({
      selectedOrderIds: ['9'],
      selectedPrinterId: '4',
      selectionSource: 'restored',
      setupContinueRequired: true,
      manualContinueRequired: false,
    });
    expect(api.createSingle).not.toHaveBeenCalled();
  });

  it('isolates persisted batch recovery by the current admin subject', () => {
    const adminSession = createAdminSessionStore();
    adminSession.set({
      ...session,
      accessToken: `header.${Buffer.from(
        JSON.stringify({ sub: '84', aud: 'mall-admin' }),
      ).toString('base64url')}.signature`,
    });
    const storage = {
      get: vi.fn((key: string) =>
        key === ADMIN_STORAGE_KEY
          ? { batchId: '8', pendingOperationKeys: {} }
          : undefined,
      ),
      remove: vi.fn(),
      set: vi.fn(),
    };
    const controller = createPrintingOrdersController({
      adminSession,
      api: setup().api as never,
      randomUUID: () => '22345678-1234-4234-9234-123456789abc',
      storage,
    });

    expect(controller.snapshot().pendingBatchId).toBeNull();
    expect(storage.get).toHaveBeenCalledWith(
      `${PRINTING_ORDERS_STORAGE_KEY}:84`,
    );
  });

  it('reuses the same single-print key after an uncertain network result', async () => {
    const { controller, api, persisted } = setup();
    const accepted = await api.createSingle();
    api.createSingle
      .mockReset()
      .mockRejectedValueOnce({ status: 0, message: '请求超时' })
      .mockResolvedValueOnce(accepted);
    await controller.load();
    controller.toggleOrder('9');

    await expect(controller.submit()).rejects.toThrow('请求超时');
    await controller.submit();

    const calls = api.createSingle.mock.calls as unknown as readonly [
      unknown,
      string,
    ][];
    const keys = calls.map(([, idempotencyKey]) => idempotencyKey);
    expect(keys).toEqual([
      '12345678-1234-4234-9234-123456789abc',
      '12345678-1234-4234-9234-123456789abc',
    ]);
    expect(persisted()).toBeUndefined();
  });

  it('rehydrates only batch ID and operation keys without automatic processing', () => {
    const adminSession = createAdminSessionStore();
    adminSession.set(session);
    const api = setup().api;
    const persisted = {
      batchId: '8',
      pendingOperationKeys: {
        'process:8': '12345678-1234-4234-9234-123456789abc',
      },
    };
    const controller = createPrintingOrdersController({
      adminSession,
      api: api as never,
      randomUUID: () => '22345678-1234-4234-9234-123456789abc',
      storage: {
        get: () => persisted,
        remove: vi.fn(),
        set: vi.fn(),
      },
    });

    expect(controller.snapshot()).toMatchObject({
      pendingBatchId: '8',
      pendingOperationKeys: persisted.pendingOperationKeys,
      manualContinueRequired: true,
      setupContinueRequired: false,
    });
    expect(api.processBatch).not.toHaveBeenCalled();
  });

  it('查询 UNKNOWN 后用返回的 job 和 batch 原子刷新结果', async () => {
    const { controller, api } = setup();
    await controller.load();
    controller.toggleOrder('9');
    await controller.submit();
    const current = controller.snapshot().result!;
    const unknownJob = {
      ...current.jobs[0]!,
      status: PrintJobStatus.UNKNOWN,
    };
    api.queryUnknown.mockResolvedValueOnce({
      batch: { ...current.batch, unknownCount: 1, acceptedCount: 0 },
      job: { ...unknownJob, status: PrintJobStatus.MANUAL_REVIEW },
    });

    await controller.queryUnknown(unknownJob);

    expect(api.queryUnknown).toHaveBeenCalledWith(
      '20',
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
    );
    expect(controller.snapshot().result).toMatchObject({
      batch: { unknownCount: 1 },
      jobs: [{ id: '20', status: PrintJobStatus.MANUAL_REVIEW }],
    });
  });

  it.each([
    'submit',
    'continueBatch',
    'queryUnknown',
    'retryFailed',
    'resolveManual',
  ] as const)('clears admin session when %s receives 401', async (operation) => {
    const { controller, api, adminSession } = setup();
    await controller.load();
    controller.toggleOrder('9');
    await controller.submit();
    const current = controller.snapshot().result!;
    const job = current.jobs[0]!;
    let affectedController = controller;
    if (operation === 'submit') {
      controller.toggleOrder('9');
      api.createSingle.mockRejectedValueOnce({ status: 401, message: 'unauthorized' });
      await expect(controller.submit()).rejects.toThrow('会话已失效');
    } else if (operation === 'continueBatch') {
      const resumable = createPrintingOrdersController({
        adminSession,
        api: api as never,
        storage: {
          get: () => ({
            batchId: '8',
            pendingOperationKeys: {},
            printerId: '4',
            printerLabel: '测试打印机（FA****01）',
          }),
          remove: vi.fn(),
          set: vi.fn(),
        },
        randomUUID: () => '32345678-1234-4234-9234-123456789abc',
      });
      affectedController = resumable;
      await resumable.load();
      api.processBatch.mockRejectedValueOnce({ status: 401, message: 'unauthorized' });
      await expect(resumable.continueBatch()).rejects.toThrow('会话已失效');
    } else if (operation === 'queryUnknown') {
      api.queryUnknown.mockRejectedValueOnce({ status: 401, message: 'unauthorized' });
      await expect(
        controller.queryUnknown({ ...job, status: PrintJobStatus.UNKNOWN }),
      ).rejects.toThrow('会话已失效');
    } else if (operation === 'retryFailed') {
      api.retryFailed.mockRejectedValueOnce({ status: 401, message: 'unauthorized' });
      await expect(
        controller.retryFailed({ ...job, status: PrintJobStatus.FAILED }, controller.createPrintIntent()),
      ).rejects.toThrow('会话已失效');
    } else {
      api.resolveManual.mockRejectedValueOnce({ status: 401, message: 'unauthorized' });
      await expect(
        controller.resolveManual(
          { ...job, status: PrintJobStatus.MANUAL_REVIEW },
          ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
          controller.createPrintIntent(),
        ),
      ).rejects.toThrow('会话已失效');
    }

    expect(adminSession.get()).toBeNull();
    expect(affectedController.snapshot()).toMatchObject({
      orders: [],
      printers: [],
      availablePrinters: [],
      selectedOrderIds: [],
      selectedPrinterId: null,
      loadSucceeded: false,
      selectionReady: false,
      result: null,
    });
  });

  it('FAILED retry 创建新批次后由客户端显式 process', async () => {
    const { controller, api } = setup();
    await controller.load();
    controller.toggleOrder('9');
    await controller.submit();
    const current = controller.snapshot().result!;
    const failedJob = {
      ...current.jobs[0]!,
      status: PrintJobStatus.FAILED,
    };
    const retryBatch = {
      ...current.batch,
      id: '8',
      status: PrintBatchStatus.READY,
      acceptedCount: 0,
      failedCount: 0,
      pendingCount: 1,
    };
    const retryJob = {
      ...failedJob,
      id: '21',
      batchId: '8',
      status: PrintJobStatus.PENDING,
      supersedesJobId: '20',
    };
    api.retryFailed.mockResolvedValueOnce({ batch: retryBatch, job: retryJob });
    api.processBatch.mockResolvedValueOnce({
      batch: {
        ...retryBatch,
        status: PrintBatchStatus.COMPLETED,
        pendingCount: 0,
        acceptedCount: 1,
      },
      processedCount: 1,
      accepted: 1,
      failed: 0,
      unknown: 0,
      manualReview: 0,
    });
    api.listJobs.mockResolvedValueOnce({
      items: [{ ...retryJob, status: PrintJobStatus.ACCEPTED }],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    await controller.retryFailed(failedJob, controller.createPrintIntent());

    expect(api.retryFailed).toHaveBeenCalledWith(
      '20',
      { printerId: '4' },
      expect.any(String),
    );
    expect(api.processBatch).toHaveBeenCalledWith('8', expect.any(String));
    expect(controller.snapshot().result).toMatchObject({
      batch: { id: '8', status: PrintBatchStatus.COMPLETED },
      jobs: [{ id: '21', status: PrintJobStatus.ACCEPTED }],
    });
  });

  it('duplicate-risk retry sends the final selected printer ID', async () => {
    const { controller, api } = setup();
    await controller.load();
    controller.toggleOrder('9');
    await controller.submit();
    const currentResult = controller.snapshot().result!;
    const reviewJob = {
      ...currentResult.jobs[0]!,
      status: PrintJobStatus.MANUAL_REVIEW,
    };
    api.resolveManual.mockResolvedValueOnce({
      resolution: ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
      retryBatch: { ...currentResult.batch, id: '8' },
      retryJob: { ...reviewJob, id: '21', batchId: '8' },
    });
    api.processBatch.mockResolvedValueOnce({
      batch: { ...currentResult.batch, id: '8' },
      processedCount: 1,
      accepted: 1,
      failed: 0,
      unknown: 0,
      manualReview: 0,
    });

    await controller.resolveManual(
      reviewJob,
      ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
      controller.createPrintIntent(),
    );

    expect(api.resolveManual).toHaveBeenCalledWith(
      reviewJob.id,
      {
        resolution: ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
        printerId: '4',
        confirmDuplicateRisk: true,
      },
      expect.any(String),
    );
  });

  it('人工确认仅接受 MANUAL_REVIEW 并精确更新对应 job', async () => {
    const { controller, api } = setup();
    await controller.load();
    controller.toggleOrder('9');
    await controller.submit();
    const current = controller.snapshot().result!;
    const reviewJob = {
      ...current.jobs[0]!,
      status: PrintJobStatus.MANUAL_REVIEW,
    };
    api.resolveManual.mockResolvedValueOnce({
      resolution: ManualPrintResolution.CONFIRM_PRINTED,
      batch: {
        ...current.batch,
        manualReviewCount: 0,
        manuallyResolvedCount: 1,
      },
      job: {
        ...reviewJob,
        status: PrintJobStatus.MANUALLY_CONFIRMED_PRINTED,
      },
    });

    await controller.resolveManual(
      reviewJob,
      ManualPrintResolution.CONFIRM_PRINTED,
    );

    expect(api.resolveManual).toHaveBeenCalledWith(
      '20',
      { resolution: ManualPrintResolution.CONFIRM_PRINTED },
      expect.any(String),
    );
    expect(controller.snapshot().result?.jobs[0]?.status).toBe(
      PrintJobStatus.MANUALLY_CONFIRMED_PRINTED,
    );
  });
});
