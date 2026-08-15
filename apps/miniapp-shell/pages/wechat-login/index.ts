import { MINIAPP_H5_ORIGIN } from '../../config/h5.generated.js';
import {
  createWechatLoginController,
  resolveWechatLoginReturnUrl,
} from '../../utils/bridge.js';
import type { BakeMallAppData } from '../../app.js';

const app = getApp<BakeMallAppData>();

function freshWechatLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }): void => resolve(code),
      fail: reject,
    });
  });
}

type WechatLoginPageData = Readonly<{
  loginEnabled: boolean;
  loginLoading: boolean;
}>;

type WechatLoginPageCustom = {
  controller?: ReturnType<typeof createWechatLoginController>;
  onCancel: () => void;
  onWechatLogin: () => Promise<void>;
};

Page<WechatLoginPageData, WechatLoginPageCustom>({
  data: {
    loginEnabled: false,
    loginLoading: false,
  },

  onLoad(query): void {
    const returnUrl = resolveWechatLoginReturnUrl(
      query.returnUrl,
      MINIAPP_H5_ORIGIN,
    );
    const state = typeof query.state === 'string' ? query.state.trim() : '';
    if (!returnUrl || !state) {
      this.setData({ loginEnabled: false, loginLoading: false });
      void wx.showToast({ title: '微信登录返回地址无效', icon: 'none' });
      return;
    }

    this.controller = createWechatLoginController({
      login: freshWechatLogin,
      navigateBack: (): void => {
        void wx.navigateBack();
      },
      returnUrl,
      state,
      toast: (title): void => {
        void wx.showToast({ title, icon: 'none' });
      },
      writeHandoff: app.wechatLoginHandoff.write,
    });
    this.setData({ loginEnabled: true, loginLoading: false }, () => {
      if (query.automatic === '1') void this.onWechatLogin();
    });
  },

  async onWechatLogin(): Promise<void> {
    if (!this.data.loginEnabled || this.data.loginLoading || !this.controller) {
      return;
    }
    this.setData({ loginLoading: true });
    const completed = await this.controller.handleLogin();
    if (!completed) this.setData({ loginLoading: false });
  },

  onCancel(): void {
    void wx.navigateBack();
  },
});
