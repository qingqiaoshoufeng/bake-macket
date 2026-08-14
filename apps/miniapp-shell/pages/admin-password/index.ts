import { createAdminApi } from '../../admin/api/index.js';
import { createAdminPasswordController } from '../../admin/hooks/admin-auth.js';
import type {
  AdminPasswordForm,
  AdminPasswordMode,
} from '../../admin/type/index.js';
import type { BakeMallAppData } from '../../app.js';

const app = getApp<BakeMallAppData>();
const api = createAdminApi(app);
const controller = createAdminPasswordController({
  adminSession: app.adminSession,
  api: {
    changeCurrent: api.changeCurrent,
    changeInitial: api.changeInitial,
  },
});

type PasswordInputEvent = Readonly<{
  currentTarget: Readonly<{ dataset: Readonly<{ field?: unknown }> }>;
  detail: Readonly<{ value?: unknown }>;
}>;

type AdminPasswordData = Readonly<{
  form: AdminPasswordForm;
  mode: AdminPasswordMode;
  submitting: boolean;
}>;

type AdminPasswordCustom = {
  onInput: (event: PasswordInputEvent) => void;
  onSubmit: () => Promise<void>;
};

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : '密码修改失败，请稍后重试';
}

Page<AdminPasswordData, AdminPasswordCustom>({
  data: controller.snapshot(),

  onShow(): void {
    if (!app.adminSession.get()) {
      void wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    this.setData(controller.snapshot());
  },

  onInput(event: PasswordInputEvent): void {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    if (
      (field === 'currentPassword' ||
        field === 'newPassword' ||
        field === 'confirmPassword') &&
      typeof value === 'string'
    ) {
      controller.replaceForm({ ...controller.snapshot().form, [field]: value });
      this.setData(controller.snapshot());
    }
  },

  async onSubmit(): Promise<void> {
    if (controller.snapshot().submitting) return;
    this.setData({ ...controller.snapshot(), submitting: true });
    try {
      await controller.submit();
      this.setData(controller.snapshot());
      void wx.showToast({ title: '密码修改成功', icon: 'success' });
      void wx.redirectTo({ url: '/pages/admin-home/index' });
    } catch (error) {
      this.setData(controller.snapshot());
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    }
  },
});
