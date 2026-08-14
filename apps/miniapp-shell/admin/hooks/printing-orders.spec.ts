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
};

function setup() {
  const adminSession = createAdminSessionStore();
  let persisted: unknown;
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
    now: () => Date.parse(NOW) + 10_000,
    storage,
  });
  return { controller, api, storage, persisted: () => persisted };
}

describe('printing orders controller', () => {
  it('loads printable orders and only ACTIVE online printers', async () => {
    const { controller, api } = setup();
    api.listPrinters.mockResolvedValueOnce({
      items: [
        printer,
        { ...printer, id: '5', onlineStatus: CloudPrinterOnlineStatus.OFFLINE },
        {
          ...printer,
          id: '6',
          lastStatusCheckedAt: '2026-08-13T00:59:00.000Z',
        },
      ],
      page: 1,
      pageSize: 100,
      total: 2,
    });

    await controller.load();

    expect(controller.snapshot()).toMatchObject({
      orders: [{ id: '9' }],
      printers: [{ id: '4' }],
      selectedPrinterId: '4',
    });
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

    expect(api.processBatch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      processedCount: 20,
      batch: { id: '8', pendingCount: 5 },
    });
    expect(controller.snapshot().manualContinueRequired).toBe(true);
    expect(controller.snapshot().pendingBatchId).toBe('8');
    expect(persisted()).toEqual({ batchId: '8', pendingOperationKeys: {} });
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

    await controller.retryFailed(failedJob);

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
