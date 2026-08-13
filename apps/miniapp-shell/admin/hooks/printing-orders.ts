import {
  AdminPermission,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  ManualPrintResolution,
  PrintJobStatus,
  type AdminSessionView,
  type ManualPrintResolutionRequest,
  type PrintBatchView,
  type PrintJobView,
  type ProcessPrintBatchResult,
} from '@bake-mall/contracts';

import type { MemorySessionStore } from '../../utils/admin-session.js';
import type { PrintingOrdersApi } from '../api/printing-orders.js';
import {
  PRINTING_ORDERS_PAGE_SIZE,
  PROCESSABLE_BATCH_STATUSES,
  isPrintableOrder,
} from '../config/printing-orders.js';
import type {
  PrintingOrdersState,
  PrintingResultSummary,
} from '../type/printing-orders.js';

const UUID_V4_TEMPLATE = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';

type Dependencies = Readonly<{
  adminSession: MemorySessionStore<AdminSessionView>;
  api: PrintingOrdersApi;
  random?: () => number;
}>;

function hasPermission(
  session: AdminSessionView | null,
  permission: AdminPermission,
): boolean {
  return Boolean(
    session &&
    session.permissions.some((candidate) => candidate === permission),
  );
}

function uuidV4(random: () => number): string {
  return UUID_V4_TEMPLATE.replace(/[xy]/gu, (token) => {
    const value = Math.floor(random() * 16);
    const nibble = token === 'x' ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

function safeMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    if ('status' in error && error.status === 401) {
      return '管理员会话已失效，请重新进入';
    }
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }
  return fallback;
}

function isAvailablePrinter(
  printer: PrintingOrdersState['printers'][number],
): boolean {
  return (
    printer.status === CloudPrinterStatus.ACTIVE &&
    printer.onlineStatus === CloudPrinterOnlineStatus.ONLINE
  );
}

function cloneState(state: PrintingOrdersState): PrintingOrdersState {
  return {
    ...state,
    orders: state.orders.map((order) => ({ ...order })),
    printers: state.printers.map((printer) => ({ ...printer })),
    selectedOrderIds: [...state.selectedOrderIds],
    result: state.result
      ? {
          ...state.result,
          batch: { ...state.result.batch },
          jobs: state.result.jobs.map((job) => ({ ...job })),
        }
      : null,
  };
}

function summaryOf(
  result: ProcessPrintBatchResult,
  jobs: readonly PrintJobView[] = [],
): PrintingResultSummary {
  return {
    batch: result.batch,
    jobs,
    processedCount: result.processedCount,
    accepted: result.accepted,
    failed: result.failed,
    unknown: result.unknown,
    manualReview: result.manualReview,
  };
}

function replaceJob(
  jobs: readonly PrintJobView[],
  replacement: PrintJobView,
): readonly PrintJobView[] {
  return jobs.map((job) => (job.id === replacement.id ? replacement : job));
}

function countsOfJobs(jobs: readonly PrintJobView[]) {
  return jobs.reduce(
    (counts, job) => ({
      accepted:
        counts.accepted + (job.status === PrintJobStatus.ACCEPTED ? 1 : 0),
      failed: counts.failed + (job.status === PrintJobStatus.FAILED ? 1 : 0),
      unknown: counts.unknown + (job.status === PrintJobStatus.UNKNOWN ? 1 : 0),
      manualReview:
        counts.manualReview +
        (job.status === PrintJobStatus.MANUAL_REVIEW ? 1 : 0),
    }),
    { accepted: 0, failed: 0, unknown: 0, manualReview: 0 },
  );
}

export function createPrintingOrdersController(dependencies: Dependencies) {
  const random = dependencies.random ?? Math.random;
  let requestGeneration = 0;
  let state: PrintingOrdersState = {
    orders: [],
    printers: [],
    selectedOrderIds: [],
    selectedPrinterId: null,
    page: 1,
    pageSize: PRINTING_ORDERS_PAGE_SIZE,
    total: 0,
    loading: false,
    submitting: false,
    error: null,
    result: null,
  };

  function authorized(): boolean {
    const session = dependencies.adminSession.get();
    return (
      hasPermission(session, AdminPermission.ORDER_READ) &&
      hasPermission(session, AdminPermission.PRINT_EXECUTE)
    );
  }

  function snapshot(): PrintingOrdersState {
    return cloneState(state);
  }

  async function load(): Promise<void> {
    if (!authorized()) throw new Error('当前账号无权打印订单');
    requestGeneration += 1;
    const requestId = requestGeneration;
    state = { ...state, loading: true, error: null };
    try {
      const [orders, printers] = await Promise.all([
        dependencies.api.listOrders({
          page: state.page,
          pageSize: state.pageSize,
        }),
        dependencies.api.listPrinters({ page: 1, pageSize: 100 }),
      ]);
      if (requestId !== requestGeneration) return;
      const printableOrders = orders.items.filter(isPrintableOrder);
      const availablePrinters = printers.items.filter(isAvailablePrinter);
      const selectedOrderIds = state.selectedOrderIds.filter((id) =>
        printableOrders.some((order) => order.id === id),
      );
      const selectedPrinterId = availablePrinters.some(
        (printer) => printer.id === state.selectedPrinterId,
      )
        ? state.selectedPrinterId
        : (availablePrinters[0]?.id ?? null);
      state = {
        ...state,
        orders: printableOrders,
        printers: availablePrinters,
        selectedOrderIds,
        selectedPrinterId,
        page: orders.page,
        pageSize: orders.pageSize,
        total: orders.total,
      };
    } catch (error) {
      const message = safeMessage(error, '订单打印数据加载失败，请稍后重试');
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 401
      ) {
        dependencies.adminSession.clear();
      }
      if (requestId === requestGeneration) state = { ...state, error: message };
      throw new Error(message);
    } finally {
      if (requestId === requestGeneration) state = { ...state, loading: false };
    }
  }

  function toggleOrder(orderId: string): void {
    if (!state.orders.some((order) => order.id === orderId)) return;
    const selected = state.selectedOrderIds.some((id) => id === orderId);
    state = {
      ...state,
      selectedOrderIds: selected
        ? state.selectedOrderIds.filter((id) => id !== orderId)
        : [...state.selectedOrderIds, orderId],
      result: null,
    };
  }

  function selectPrinter(printerId: string): void {
    if (!state.printers.some((printer) => printer.id === printerId)) return;
    state = { ...state, selectedPrinterId: printerId, result: null };
  }

  async function submit(): Promise<PrintingResultSummary> {
    if (!authorized()) throw new Error('当前账号无权打印订单');
    if (state.submitting) throw new Error('打印请求正在提交，请勿重复操作');
    if (!state.selectedPrinterId) throw new Error('请选择一台在线打印机');
    if (state.selectedOrderIds.length === 0)
      throw new Error('请至少选择一笔订单');

    const printerId = state.selectedPrinterId;
    const orderIds = [...state.selectedOrderIds];
    state = { ...state, submitting: true, error: null, result: null };
    try {
      if (orderIds.length === 1) {
        const single = await dependencies.api.createSingle(
          { orderId: orderIds[0]!, printerId },
          uuidV4(random),
        );
        const result: PrintingResultSummary = {
          batch: single.batch,
          jobs: [single.job],
          processedCount: 1,
          accepted: single.job.status === 'ACCEPTED' ? 1 : 0,
          failed: single.job.status === 'FAILED' ? 1 : 0,
          unknown: single.job.status === 'UNKNOWN' ? 1 : 0,
          manualReview: single.job.status === 'MANUAL_REVIEW' ? 1 : 0,
        };
        state = { ...state, result, selectedOrderIds: [] };
        return result;
      }

      const created = await dependencies.api.createBatch(
        { printerId },
        uuidV4(random),
      );
      await dependencies.api.appendBatch(
        created.batch.id,
        { orderIds },
        uuidV4(random),
      );
      await dependencies.api.sealBatch(created.batch.id, uuidV4(random));
      let processed = await dependencies.api.processBatch(
        created.batch.id,
        uuidV4(random),
      );
      const totals = {
        processedCount: processed.processedCount,
        accepted: processed.accepted,
        failed: processed.failed,
        unknown: processed.unknown,
        manualReview: processed.manualReview,
      };
      while (
        PROCESSABLE_BATCH_STATUSES.some(
          (status) => status === processed.batch.status,
        )
      ) {
        if (processed.batch.pendingCount === 0) break;
        processed = await dependencies.api.processBatch(
          created.batch.id,
          uuidV4(random),
        );
        totals.processedCount += processed.processedCount;
        totals.accepted += processed.accepted;
        totals.failed += processed.failed;
        totals.unknown += processed.unknown;
        totals.manualReview += processed.manualReview;
      }
      const jobs = await dependencies.api.listJobs({
        batchId: created.batch.id,
        page: 1,
        pageSize: 100,
      });
      const result = {
        ...summaryOf(processed, jobs.items),
        ...totals,
      };
      state = { ...state, result, selectedOrderIds: [] };
      return result;
    } catch (error) {
      const message = safeMessage(error, '打印请求失败，请稍后重试');
      state = { ...state, error: message };
      throw new Error(message);
    } finally {
      state = { ...state, submitting: false };
    }
  }

  function updateResolvedJob(batch: PrintBatchView, job: PrintJobView): void {
    if (!state.result) return;
    const jobs = replaceJob(state.result.jobs, job);
    state = {
      ...state,
      result: { ...state.result, batch, jobs, ...countsOfJobs(jobs) },
    };
  }

  async function runRecovery(
    operation: () => Promise<void>,
    fallback: string,
  ): Promise<void> {
    state = { ...state, submitting: true, error: null };
    try {
      await operation();
    } catch (error) {
      const message = safeMessage(error, fallback);
      state = { ...state, error: message };
      throw new Error(message);
    } finally {
      state = { ...state, submitting: false };
    }
  }

  async function queryUnknown(job: PrintJobView): Promise<void> {
    if (job.status !== PrintJobStatus.UNKNOWN) {
      throw new Error('仅状态未知的打印任务可以查询');
    }
    await runRecovery(async () => {
      const result = await dependencies.api.queryUnknown(
        job.id,
        uuidV4(random),
      );
      updateResolvedJob(result.batch, result.job);
    }, '未知任务查询失败，请稍后重试');
  }

  async function processRecoveryBatch(batchId: string): Promise<void> {
    const processed = await dependencies.api.processBatch(
      batchId,
      uuidV4(random),
    );
    const jobs = await dependencies.api.listJobs({
      batchId,
      page: 1,
      pageSize: 100,
    });
    state = { ...state, result: summaryOf(processed, jobs.items) };
  }

  async function retryFailed(job: PrintJobView): Promise<void> {
    if (job.status !== PrintJobStatus.FAILED) {
      throw new Error('仅明确失败的打印任务可以重试');
    }
    if (!state.selectedPrinterId) throw new Error('请选择一台在线打印机');
    const printerId = state.selectedPrinterId;
    await runRecovery(async () => {
      const retry = await dependencies.api.retryFailed(
        job.id,
        { printerId },
        uuidV4(random),
      );
      await processRecoveryBatch(retry.batch.id);
    }, '失败任务重试失败，请稍后重试');
  }

  async function resolveManual(
    job: PrintJobView,
    resolution: ManualPrintResolution,
  ): Promise<void> {
    if (job.status !== PrintJobStatus.MANUAL_REVIEW) {
      throw new Error('仅人工复核任务可以处置');
    }
    if (
      resolution === ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK &&
      !state.selectedPrinterId
    ) {
      throw new Error('请选择一台在线打印机');
    }
    const request: ManualPrintResolutionRequest =
      resolution === ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK
        ? {
            resolution,
            printerId: state.selectedPrinterId!,
            confirmDuplicateRisk: true,
          }
        : { resolution };
    await runRecovery(async () => {
      const result = await dependencies.api.resolveManual(
        job.id,
        request,
        uuidV4(random),
      );
      if (
        result.resolution === ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK
      ) {
        await processRecoveryBatch(result.retryBatch.id);
      } else {
        updateResolvedJob(result.batch, result.job);
      }
    }, '人工处置失败，请稍后重试');
  }

  async function setPage(page: number): Promise<void> {
    state = { ...state, page, selectedOrderIds: [], result: null };
    await load();
  }

  return {
    authorized,
    load,
    queryUnknown,
    resolveManual,
    retryFailed,
    selectPrinter,
    setPage,
    snapshot,
    submit,
    toggleOrder,
  } as const;
}
