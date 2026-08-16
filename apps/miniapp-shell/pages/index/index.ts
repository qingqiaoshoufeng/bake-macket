import {
  MINIAPP_H5_ORIGIN,
  MINIAPP_H5_URL,
} from '../../config/h5.generated.js';
import { createAdminApi } from '../../admin/api/index.js';
import { createAdminAuthController } from '../../admin/hooks/admin-auth.js';
import { createIndexPageController } from '../../utils/bridge.js';
import type { BakeMallAppData } from '../../app.js';

const app = getApp<BakeMallAppData>();
const adminApi = createAdminApi(app);

function freshWechatLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }): void => resolve(code),
      fail: reject,
    });
  });
}

function confirmAdminEntry(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: '门店管理',
      content: '检测到门店管理权限，是否进入管理页面？',
      confirmText: '进入管理',
      cancelText: '继续逛店',
      success: ({ confirm }): void => resolve(confirm),
      fail: (): void => resolve(false),
    });
  });
}

type IndexPageData = Readonly<{
  adminEligible: boolean;
  adminLoading: boolean;
  deliveryId: string;
  h5Url: string;
  showWebView: boolean;
  webViewMessage: string;
  webViewState: 'error' | 'loaded' | 'loading';
}>;

type WebViewEvent = Readonly<{
  currentTarget: Readonly<{ dataset: Readonly<{ deliveryId?: unknown }> }>;
}>;

type IndexPageCustom = {
  adminController?: ReturnType<typeof createAdminAuthController>;
  adminFlowActive: boolean;
  controller?: ReturnType<typeof createIndexPageController>;
  onEnterAdmin: () => Promise<void>;
  onWebViewError: (event: WebViewEvent) => void;
  onWebViewLoad: (event: WebViewEvent) => void;
};

Page<IndexPageData, IndexPageCustom>({
  adminFlowActive: false,

  data: {
    adminEligible: false,
    adminLoading: false,
    deliveryId: '',
    h5Url: '',
    showWebView: false,
    webViewMessage: '正在加载商城网页…',
    webViewState: 'loading',
  },

  onLoad(): void {
    this.adminController = createAdminAuthController({
      adminSession: app.adminSession,
      api: adminApi,
      customerSession: app.customerSession,
      login: freshWechatLogin,
      navigate: (url): void => {
        void wx.navigateTo({
          url,
          fail: (): void => {
            void wx.showToast({
              title: '管理页面打开失败，请重新进入',
              icon: 'none',
            });
          },
        });
      },
      toast: (title): void => {
        void wx.showToast({ title, icon: 'none' });
      },
    });
    this.controller = createIndexPageController({
      baseOrigin: MINIAPP_H5_ORIGIN,
      baseUrl: MINIAPP_H5_URL,
      consumePhoneHandoff: app.phoneCredentialHandoff.consume,
      consumeWechatLoginHandoff: app.wechatLoginHandoff.consume,
      peekPhoneHandoff: app.phoneCredentialHandoff.peek,
      peekWechatLoginHandoff: app.wechatLoginHandoff.peek,
      rebuildWebView: (h5Url, deliveryId): boolean => {
        try {
          this.setData(
            {
              showWebView: false,
              webViewMessage: '正在加载商城网页…',
              webViewState: 'loading',
            },
            () => {
              this.setData({ deliveryId, h5Url, showWebView: true });
            },
          );
          return true;
        } catch {
          return false;
        }
      },
      toast: (title): void => {
        void wx.showToast({ title, icon: 'none' });
      },
    });
  },

  async onShow(): Promise<void> {
    this.controller?.handleShow();
    const adminController = this.adminController;
    if (!adminController || this.adminFlowActive) return;

    this.adminFlowActive = true;
    try {
      this.setData({ adminEligible: false, adminLoading: true });
      const eligible = await adminController.refreshEligibility();
      this.setData({ adminEligible: eligible, adminLoading: false });

      if (eligible && (await confirmAdminEntry())) {
        await this.onEnterAdmin();
      }
    } finally {
      this.adminFlowActive = false;
    }
  },

  async onEnterAdmin(): Promise<void> {
    const adminController = this.adminController;
    if (!adminController || this.data.adminLoading) return;

    this.setData({ adminEligible: false, adminLoading: true });
    await adminController.enterAdmin();
    this.setData({
      adminEligible: adminController.snapshot().eligible,
      adminLoading: false,
    });
  },

  onWebViewLoad(event): void {
    this.setData({
      webViewMessage: '商城网页已加载',
      webViewState: 'loaded',
    });
    this.controller?.handleWebViewLoad(event.currentTarget.dataset.deliveryId);
  },

  onWebViewError(event): void {
    this.setData({
      webViewMessage: '商城网页加载失败',
      webViewState: 'error',
    });
    this.controller?.handleWebViewError(event.currentTarget.dataset.deliveryId);
    wx.showToast({ title: '商城页面加载失败，请检查网络', icon: 'none' });
  },
});
