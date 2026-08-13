import { AdminPermission, type CloudPrinterView } from '@bake-mall/contracts';

import { createPrintingDevicesApi } from '../../admin/api/printing-devices.js';
import { PRINTER_ACTION_LABELS } from '../../admin/config/printing-devices.js';
import { createPrintingDevicesController } from '../../admin/hooks/printing-devices.js';
import type {
  PrintingDeviceAction,
  PrintingDeviceOperation,
  PrintingDevicesState,
} from '../../admin/type/printing-devices.js';
import type { BakeMallAppData } from '../../app.js';

const app = getApp<BakeMallAppData>();
const api = createPrintingDevicesApi(app);
const controller = createPrintingDevicesController({
  adminSession: app.adminSession,
  api,
});

type InputEvent = Readonly<{
  currentTarget: Readonly<{ dataset: Readonly<{ field?: unknown }> }>;
  detail: Readonly<{ value?: unknown }>;
}>;
type ActionEvent = Readonly<{
  detail: Readonly<{ action?: unknown; printerId?: unknown }>;
}>;
type ContinueEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<{ operation?: unknown; printerId?: unknown }>;
  }>;
}>;
type PrinterRow = CloudPrinterView &
  Readonly<{
    actions: readonly Readonly<{
      disabled: boolean;
      label: string;
      value: PrintingDeviceAction;
    }>[];
  }>;
type PageData = PrintingDevicesState &
  Readonly<{ printerRows: readonly PrinterRow[] }>;
type PageCustom = {
  onBindInput: (event: InputEvent) => void;
  onCloseDialog: () => void;
  onContinue: (event: ContinueEvent) => Promise<void>;
  onHide: () => void;
  onNextPage: () => Promise<void>;
  onOpenBind: () => void;
  onPreviousPage: () => Promise<void>;
  onPrinterAction: (event: ActionEvent) => Promise<void>;
  onRecoveryInput: (event: InputEvent) => void;
  onRenameInput: (event: InputEvent) => void;
  onRetry: () => Promise<void>;
  onShow: () => Promise<void>;
  onSubmitBind: () => Promise<void>;
  onSubmitRecovery: () => Promise<void>;
  onSubmitRename: () => Promise<void>;
  onSubmitVerify: () => Promise<void>;
  onUnload: () => void;
  onVerifyInput: (event: InputEvent) => void;
};

let countdownTimer: ReturnType<typeof setInterval> | null = null;

function valueFrom(event: InputEvent): string {
  return typeof event.detail.value === 'string' ? event.detail.value : '';
}

function pageData(): PageData {
  const state = controller.snapshot();
  return {
    ...state,
    printerRows: state.devices.map((device) => ({
      ...device,
      actions: controller.actionsFor(device).map((action) => ({
        disabled: pending(action === 'verify' ? 'confirm' : action, device.id),
        label: PRINTER_ACTION_LABELS[action],
        value: action,
      })),
    })),
  };
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : '打印机操作失败，请稍后重试';
}

function printerById(printerId: string): CloudPrinterView | null {
  return (
    controller.snapshot().devices.find((device) => device.id === printerId) ??
    null
  );
}

function pending(
  operation: PrintingDeviceOperation,
  resourceId?: string,
): boolean {
  return controller
    .snapshot()
    .operations.some(
      (candidate) =>
        candidate.operation === operation &&
        candidate.resourceId === resourceId,
    );
}

function stopCountdown(): void {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function startCountdown(
  page: WechatMiniprogram.Page.Instance<PageData, PageCustom>,
): void {
  stopCountdown();
  countdownTimer = setInterval(() => {
    controller.updateCountdown();
    page.setData(pageData());
  }, 1000);
}

function redirectToEntry(): void {
  app.adminSession.clear();
  controller.syncAdminIdentity();
  void wx.reLaunch({ url: '/pages/index/index' });
}

Page<PageData, PageCustom>({
  data: pageData(),

  async onShow(): Promise<void> {
    const session = app.adminSession.get();
    if (!session) {
      redirectToEntry();
      return;
    }
    if (session.mustChangePassword) {
      void wx.redirectTo({ url: '/pages/admin-password/index' });
      return;
    }
    if (
      !session.permissions.some(
        (permission) => permission === AdminPermission.PRINT_DEVICE_MANAGE,
      ) ||
      !controller.authorized()
    ) {
      redirectToEntry();
      return;
    }
    startCountdown(this);
    await this.onRetry();
  },

  onHide(): void {
    stopCountdown();
    controller.persistLifecycleState();
  },

  onUnload(): void {
    stopCountdown();
    controller.persistLifecycleState();
  },

  onOpenBind(): void {
    controller.openBind();
    this.setData(pageData());
  },

  onCloseDialog(): void {
    controller.closeDialog();
    this.setData(pageData());
  },

  onBindInput(event): void {
    const field = event.currentTarget.dataset.field;
    if (
      field === 'serialNumber' ||
      field === 'displayName' ||
      field === 'operationPassword'
    ) {
      controller.setBindForm({
        ...controller.snapshot().forms.bind,
        [field]: valueFrom(event),
      });
      this.setData(pageData());
    }
  },

  onVerifyInput(event): void {
    const field = event.currentTarget.dataset.field;
    if (field === 'code' || field === 'operationPassword') {
      controller.setVerifyForm({
        code: controller.snapshot().forms.verify.code,
        operationPassword: controller.snapshot().forms.verify.operationPassword,
        [field]: valueFrom(event),
      });
      this.setData(pageData());
    }
  },

  onRecoveryInput(event): void {
    controller.setRecoveryPassword(valueFrom(event));
    this.setData(pageData());
  },

  onRenameInput(event): void {
    controller.setRenameName(valueFrom(event));
    this.setData(pageData());
  },

  async onRetry(): Promise<void> {
    try {
      await controller.load();
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
      if (!app.adminSession.get()) redirectToEntry();
    } finally {
      this.setData(pageData());
    }
  },

  async onSubmitBind(): Promise<void> {
    try {
      if (pending('bind')) await controller.continueOperation('bind');
      else await controller.bind();
      void wx.showToast({ title: '绑定请求已提交', icon: 'success' });
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      this.setData(pageData());
    }
  },

  async onSubmitVerify(): Promise<void> {
    const printerId = controller.snapshot().dialog.resourceId;
    if (!printerId) return;
    try {
      if (pending('confirm', printerId)) {
        await controller.continueOperation('confirm', printerId);
      } else {
        await controller.confirm(printerId);
      }
      void wx.showToast({ title: '打印机验证成功', icon: 'success' });
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      this.setData(pageData());
    }
  },

  async onSubmitRecovery(): Promise<void> {
    const { resourceId, recoveryAction } = controller.snapshot().dialog;
    if (!resourceId || !recoveryAction) return;
    try {
      if (pending(recoveryAction, resourceId)) {
        await controller.continueOperation(recoveryAction, resourceId);
      } else if (recoveryAction === 'resend') {
        await controller.resend(resourceId);
      } else if (recoveryAction === 'requery') {
        await controller.requery(resourceId);
      } else if (recoveryAction === 'unbind') {
        await controller.unbind(resourceId);
      } else {
        await controller.confirmDeletion(resourceId);
      }
      void wx.showToast({ title: '恢复操作已提交', icon: 'success' });
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      this.setData(pageData());
    }
  },

  async onSubmitRename(): Promise<void> {
    const printerId = controller.snapshot().dialog.resourceId;
    if (!printerId) return;
    try {
      if (pending('rename', printerId)) {
        await controller.continueOperation('rename', printerId);
      } else {
        await controller.rename(printerId);
      }
      void wx.showToast({ title: '名称已更新', icon: 'success' });
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      this.setData(pageData());
    }
  },

  async onPrinterAction(event): Promise<void> {
    const action = event.detail.action;
    const printerId = event.detail.printerId;
    if (typeof action !== 'string' || typeof printerId !== 'string') return;
    const printer = printerById(printerId);
    if (!printer) return;
    if (action === 'verify') controller.openVerify(printer);
    else if (action === 'rename') controller.openRename(printer);
    else if (action === 'unbind') {
      const confirmed = await new Promise<boolean>((resolve) => {
        wx.showModal({
          title: '确认解绑打印机',
          content: `解绑“${printer.displayName}”后将不能继续提交打印任务。`,
          success: ({ confirm }) => resolve(confirm),
          fail: () => resolve(false),
        });
      });
      if (confirmed) controller.openRecovery('unbind', printer);
    } else if (
      action === 'resend' ||
      action === 'requery' ||
      action === 'delete-confirm'
    ) {
      controller.openRecovery(action, printer);
    } else if (action === 'refresh') {
      try {
        if (pending('refresh', printerId)) {
          await controller.continueOperation('refresh', printerId);
        } else {
          await controller.refreshOnlineStatus(printerId);
        }
      } catch (error) {
        void wx.showToast({ title: safeMessage(error), icon: 'none' });
      }
    }
    this.setData(pageData());
  },

  async onContinue(event): Promise<void> {
    const operation = event.currentTarget.dataset.operation;
    const printerId = event.currentTarget.dataset.printerId;
    if (
      typeof operation !== 'string' ||
      !controller
        .snapshot()
        .operations.some(
          (candidate) =>
            candidate.operation === operation &&
            candidate.resourceId === printerId,
        )
    )
      return;
    if (operation === 'bind') controller.openBind();
    else if (typeof printerId === 'string') {
      const printer = printerById(printerId);
      if (!printer) return;
      if (operation === 'confirm') controller.openVerify(printer);
      else if (operation === 'rename') controller.openRename(printer);
      else if (
        operation === 'resend' ||
        operation === 'requery' ||
        operation === 'delete-confirm' ||
        operation === 'unbind'
      )
        controller.openRecovery(operation, printer);
      else if (operation === 'refresh') {
        try {
          await controller.continueOperation('refresh', printerId);
        } catch (error) {
          void wx.showToast({ title: safeMessage(error), icon: 'none' });
        }
      }
    }
    this.setData(pageData());
  },

  async onPreviousPage(): Promise<void> {
    if (this.data.loading || this.data.page <= 1) return;
    try {
      await controller.setPage(this.data.page - 1);
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      this.setData(pageData());
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
      this.setData(pageData());
    }
  },
});
