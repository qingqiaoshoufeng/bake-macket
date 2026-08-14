import { createAdminApi } from '../../admin/api/index.js';
import { createUsersController } from '../../admin/hooks/users.js';
import type { AdminUsersState } from '../../admin/type/index.js';
import type { BakeMallAppData } from '../../app.js';

const app = getApp<BakeMallAppData>();
const api = createAdminApi(app);
const controller = createUsersController({
  adminSession: app.adminSession,
  api: {
    create: api.createUser,
    list: api.listUsers,
  },
});

type InputEvent = Readonly<{ detail: Readonly<{ value?: unknown }> }>;

type AdminUsersCustom = {
  onCreate: () => Promise<void>;
  onCreatePhoneInput: (event: InputEvent) => void;
  onNextPage: () => Promise<void>;
  onPreviousPage: () => Promise<void>;
  onQueryInput: (event: InputEvent) => void;
  onRetry: () => Promise<void>;
  onSearch: () => Promise<void>;
};

function inputValue(event: InputEvent): string {
  return typeof event.detail.value === 'string' ? event.detail.value : '';
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}

Page<AdminUsersState, AdminUsersCustom>({
  data: controller.snapshot(),

  async onShow(): Promise<void> {
    const session = app.adminSession.get();
    if (!session) {
      void wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    if (session.mustChangePassword) {
      void wx.redirectTo({ url: '/pages/admin-password/index' });
      return;
    }
    await this.onRetry();
  },

  onQueryInput(event): void {
    controller.setQuery(inputValue(event));
    this.setData(controller.snapshot());
  },

  onCreatePhoneInput(event): void {
    controller.setCreatePhone(inputValue(event));
    this.setData(controller.snapshot());
  },

  async onSearch(): Promise<void> {
    try {
      await controller.search();
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      this.setData(controller.snapshot());
    }
  },

  async onRetry(): Promise<void> {
    try {
      await controller.refresh();
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
      if (!app.adminSession.get()) {
        void wx.reLaunch({ url: '/pages/index/index' });
      }
    } finally {
      this.setData(controller.snapshot());
    }
  },

  async onCreate(): Promise<void> {
    try {
      await controller.createUser();
      void wx.showToast({ title: '用户添加成功', icon: 'success' });
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
      if (!app.adminSession.get()) {
        void wx.reLaunch({ url: '/pages/index/index' });
      }
    } finally {
      this.setData(controller.snapshot());
    }
  },

  async onPreviousPage(): Promise<void> {
    if (this.data.loading || this.data.page <= 1) return;
    try {
      await controller.setPage(this.data.page - 1);
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      this.setData(controller.snapshot());
    }
  },

  async onNextPage(): Promise<void> {
    const lastPage = Math.max(
      1,
      Math.ceil(this.data.total / this.data.pageSize),
    );
    if (this.data.loading || this.data.page >= lastPage) return;
    try {
      await controller.setPage(this.data.page + 1);
    } catch (error) {
      void wx.showToast({ title: safeMessage(error), icon: 'none' });
    } finally {
      this.setData(controller.snapshot());
    }
  },
});
