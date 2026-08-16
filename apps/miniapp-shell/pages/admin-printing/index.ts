import type {
  AdminOrderListItem,
  CloudPrinterView,
  PrintJobView,
} from '@bake-mall/contracts';

import {
  ManualPrintResolution,
  PrintJobStatus,
} from '../../config/contracts.generated.js';
import { createPrintingOrdersApi } from '../../admin/api/printing-orders.js';
import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  PRINT_JOB_STATUS_LABELS,
  formatCents,
} from '../../admin/config/printing-orders.js';
import {
  createPrintingOrdersController,
  printerUnavailableReason,
} from '../../admin/hooks/printing-orders.js';
import type {
  PrintingJobRow,
  PrintingOrderRow,
  PrintingOrdersState,
  PrintingPrinterOption,
} from '../../admin/type/printing-orders.js';
import type { BakeMallAppData } from '../../app.js';

const app = getApp<BakeMallAppData>();
const controller = createPrintingOrdersController({
  adminSession: app.adminSession,
  api: createPrintingOrdersApi(app),
});

type PageData = PrintingOrdersState &
  Readonly<{
    orderRows: readonly PrintingOrderRow[];
    printerOptions: readonly PrintingPrinterOption[];
    jobRows: readonly PrintingJobRow[];
    canSubmit: boolean;
    selectedPrinterLabel: string;
  }>;

type ToggleEvent = Readonly<{ detail: Readonly<{ orderId?: unknown }> }>;
type PrinterEvent = Readonly<{
  currentTarget: Readonly<{ dataset: Readonly<{ printerId?: unknown }> }>;
}>;
type JobEvent = Readonly<{
  currentTarget: Readonly<{ dataset: Readonly<{ jobId?: unknown }> }>;
}>;

type PageCustom = {
  onConfirmNotPrinted: (event: JobEvent) => Promise<void>;
  onConfirmPrinted: (event: JobEvent) => Promise<void>;
  onContinueBatch: () => Promise<void>;
  onDuplicateRiskRetry: (event: JobEvent) => Promise<void>;
  onNextPage: () => Promise<void>;
  onQueryUnknown: (event: JobEvent) => Promise<void>;
  onPreviousPage: () => Promise<void>;
  onRetry: () => Promise<void>;
  onRetryFailed: (event: JobEvent) => Promise<void>;
  onSelectPrinter: (event: PrinterEvent) => void;
  onResumeSetup: () => Promise<void>;
  onSubmit: () => Promise<void>;
  onToggleOrder: (event: ToggleEvent) => void;
};

function orderRow(
  order: AdminOrderListItem,
  selectedOrderIds: readonly string[],
): PrintingOrderRow {
  return {
    ...order,
    selected: selectedOrderIds.some((id) => id === order.id),
    statusLabel: ORDER_STATUS_LABELS[order.status],
    fulfillmentLabel: FULFILLMENT_LABELS[order.fulfillmentType],
    payableText: formatCents(order.payableTotalCents),
  };
}

function printerOption(
  printer: CloudPrinterView,
  state: PrintingOrdersState,
  at: number,
): PrintingPrinterOption {
  const unavailableReason = printerUnavailableReason(printer, at);
  return {
    ...printer,
    selected: printer.id === state.selectedPrinterId,
    available: unavailableReason === null,
    current: printer.id === state.current?.printer?.id,
    unavailableReason,
  };
}

function selectedPrinterLabel(state: PrintingOrdersState): string {
  const selected = state.printers.find(
    (printer) => printer.id === state.selectedPrinterId,
  );
  return selected
    ? `${selected.displayName}（${selected.serialNumberMasked}）`
    : '尚未选择设备';
}

function jobRow(job: PrintJobView): PrintingJobRow {
  return {
    ...job,
    statusLabel: PRINT_JOB_STATUS_LABELS[job.status],
    canQueryUnknown: job.status === PrintJobStatus.UNKNOWN,
    canRetryFailed: job.status === PrintJobStatus.FAILED,
    canResolveManually: job.status === PrintJobStatus.MANUAL_REVIEW,
  };
}

function pageData(): PageData {
  const state = controller.snapshot();
  const at = Date.now();
  const printerOptions = state.printers.map((printer) =>
    printerOption(printer, state, at),
  );
  const selectedOption = printerOptions.find(
    (printer) => printer.id === state.selectedPrinterId,
  );
  return {
    ...state,
    orderRows: state.orders.map((order) =>
      orderRow(order, state.selectedOrderIds),
    ),
    printerOptions,
    jobRows: (state.result?.jobs ?? []).map(jobRow),
    canSubmit:
      !state.loading &&
      !state.submitting &&
      state.loadSucceeded &&
      state.selectionReady &&
      state.selectedOrderIds.length > 0 &&
      selectedOption?.available === true,
    selectedPrinterLabel: selectedPrinterLabel(state),
  };
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : '订单打印操作失败';
}

function syncPageAndHandleSession(
  page: Readonly<{ setData: (data: PageData) => void }>,
): void {
  page.setData(pageData());
  if (!app.adminSession.get()) {
    void wx.reLaunch({ url: '/pages/index/index' });
  }
}

function findJob(event: JobEvent): PrintJobView | null {
  const jobId = event.currentTarget.dataset.jobId;
  if (typeof jobId !== 'string') return null;
  return (
    controller.snapshot().result?.jobs.find((job) => job.id === jobId) ?? null
  );
}

function confirm(
  content: string,
  title = '确认打印任务处置',
): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      success: ({ confirm: accepted }) => resolve(accepted),
      fail: () => resolve(false),
    });
  });
}

Page<PageData, PageCustom>({
  data: pageData(),

  async onShow(): Promise<void> {
    const session = app.adminSession.get();
    if (!session || !controller.authorized()) {
      app.adminSession.clear();
      void wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    if (session.mustChangePassword) {
      void wx.redirectTo({ url: '/pages/admin-password/index' });
      return;
    }
    await this.onRetry();
  },

  async onRetry(): Promise<void> {
    try {
      const loading = controller.load();
      this.setData(pageData());
      await loading;
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
      if (!app.adminSession.get()) {
        void wx.reLaunch({ url: '/pages/index/index' });
      }
    } finally {
      syncPageAndHandleSession(this);
    }
  },

  onToggleOrder(event): void {
    const orderId = event.detail.orderId;
    if (typeof orderId !== 'string') return;
    controller.toggleOrder(orderId);
    this.setData(pageData());
  },

  onSelectPrinter(event): void {
    const printerId = event.currentTarget.dataset.printerId;
    if (typeof printerId !== 'string') return;
    controller.selectPrinter(printerId);
    this.setData(pageData());
  },

  async onResumeSetup(): Promise<void> {
    if (!(await confirm('将使用原操作标识恢复上次未确认的打印请求。', '确认恢复打印'))) {
      return;
    }
    await this.onSubmit();
  },

  async onSubmit(): Promise<void> {
    try {
      const count = controller.snapshot().selectedOrderIds.length;
      const intent = controller.createPrintIntent();
      const confirmed = await confirm(
        `将向 ${intent.printerLabel} 提交 ${count} 笔订单。厂商接受不代表已经物理出纸。`,
        count === 1 ? '确认打印订单' : '确认批量打印',
      );
      if (!confirmed) return;
      const result = await controller.submit(intent);
      void wx.showToast({
        title: `厂商已接受 ${result.accepted} 项`,
        icon: result.failed + result.unknown > 0 ? 'none' : 'success',
      });
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      syncPageAndHandleSession(this);
    }
  },

  async onContinueBatch(): Promise<void> {
    if (!(await confirm('将继续提交下一批待打印任务（最多 20 项）。', '确认继续批次'))) {
      return;
    }
    try {
      const result = await controller.continueBatch();
      void wx.showToast({
        title: `本次厂商接受 ${result.accepted} 项`,
        icon: result.failed + result.unknown > 0 ? 'none' : 'success',
      });
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      syncPageAndHandleSession(this);
    }
  },

  async onQueryUnknown(event): Promise<void> {
    const job = findJob(event);
    if (!job) return;
    try {
      await controller.queryUnknown(job);
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      syncPageAndHandleSession(this);
    }
  },

  async onRetryFailed(event): Promise<void> {
    const job = findJob(event);
    if (!job) return;
    try {
      const intent = controller.createPrintIntent();
      if (
        !(await confirm(
          `将使用 ${intent.printerLabel} 从订单快照创建新的打印任务并立即提交。`,
        ))
      ) {
        return;
      }
      await controller.retryFailed(job, intent);
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      syncPageAndHandleSession(this);
    }
  },

  async onConfirmPrinted(event): Promise<void> {
    const job = findJob(event);
    if (!job || !(await confirm('确认该订单已经物理出纸？此操作不可撤销。')))
      return;
    try {
      await controller.resolveManual(
        job,
        ManualPrintResolution.CONFIRM_PRINTED,
      );
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      syncPageAndHandleSession(this);
    }
  },

  async onConfirmNotPrinted(event): Promise<void> {
    const job = findJob(event);
    if (
      !job ||
      !(await confirm('确认该订单没有出纸，并将任务标记为明确失败？'))
    )
      return;
    try {
      await controller.resolveManual(
        job,
        ManualPrintResolution.CONFIRM_NOT_PRINTED,
      );
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      syncPageAndHandleSession(this);
    }
  },

  async onDuplicateRiskRetry(event): Promise<void> {
    const job = findJob(event);
    if (!job) return;
    try {
      const intent = controller.createPrintIntent();
      if (
        !(await confirm(
          `该操作可能重复出纸。确认使用 ${intent.printerLabel} 承担重复打印风险并创建新的打印任务？`,
        ))
      ) {
        return;
      }
      await controller.resolveManual(
        job,
        ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
        intent,
      );
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      syncPageAndHandleSession(this);
    }
  },

  async onPreviousPage(): Promise<void> {
    if (this.data.loading || this.data.page <= 1) return;
    try {
      await controller.setPage(this.data.page - 1);
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      syncPageAndHandleSession(this);
    }
  },

  async onNextPage(): Promise<void> {
    if (
      this.data.loading ||
      this.data.page * this.data.pageSize >= this.data.total
    )
      return;
    try {
      await controller.setPage(this.data.page + 1);
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      syncPageAndHandleSession(this);
    }
  },
});
