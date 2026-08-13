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
import { createPrintingOrdersController } from './printing-orders.js';

const NOW = '2026-08-13T01:00:00.000Z';
const session: AdminSessionView = {
  accessToken: 'token',
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
    random: () => 0.1,
  });
  return { controller, api };
}

describe('printing orders controller', () => {
  it('loads printable orders and only ACTIVE online printers', async () => {
    const { controller, api } = setup();
    api.listPrinters.mockResolvedValueOnce({
      items: [
        printer,
        { ...printer, id: '5', onlineStatus: CloudPrinterOnlineStatus.OFFLINE },
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
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
    );
    expect(controller.snapshot().selectedOrderIds).toEqual([]);
    expect(controller.snapshot().result?.jobs).toEqual([
      expect.objectContaining({ id: '20' }),
    ]);
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
