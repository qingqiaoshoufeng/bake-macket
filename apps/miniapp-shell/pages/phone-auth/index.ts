import { createAdminApi } from '../../admin/api/index.js';
import { createAdminAuthController } from '../../admin/hooks/admin-auth.js';
import {
  createPhoneAuthController,
  resolvePhoneAuthReturnUrl,
} from '../../utils/bridge.js';
import { MINIAPP_H5_ORIGIN } from '../../config/h5.generated.js';
import type { BakeMallAppData } from '../../app.js';

const app = getApp<BakeMallAppData>();
const adminApi = createAdminApi(app);

type PhoneAuthFlow = 'admin' | 'h5';

type PhoneAuthPageData = Readonly<{
  authorizationEnabled: boolean;
  flow: PhoneAuthFlow;
  returnUrl: string;
}>;

type PhoneAuthPageCustom = {
  adminController?: ReturnType<typeof createAdminAuthController>;
  controller?: ReturnType<typeof createPhoneAuthController>;
  onGetPhoneNumber: (
    event: WechatMiniprogram.ButtonGetPhoneNumber,
  ) => Promise<void>;
  onCancel: () => void;
};

Page<PhoneAuthPageData, PhoneAuthPageCustom>({
  data: {
    authorizationEnabled: false,
    flow: 'h5',
    returnUrl: '',
  },

  onLoad(query): void {
    if (query.flow === 'admin') {
      this.adminController = createAdminAuthController({
        adminSession: app.adminSession,
        api: adminApi,
        customerSession: app.customerSession,
        login: (): Promise<string> => Promise.reject(new Error('无需重复登录')),
        navigate: (url): void => {
          void wx.redirectTo({ url });
        },
        toast: (title): void => {
          void wx.showToast({ title, icon: 'none' });
        },
      });
      this.setData({
        authorizationEnabled: true,
        flow: 'admin',
        returnUrl: '',
      });
      return;
    }

    const returnUrl = resolvePhoneAuthReturnUrl(
      query.returnUrl,
      MINIAPP_H5_ORIGIN,
    );
    if (!returnUrl) {
      this.setData({ authorizationEnabled: false, returnUrl: '' });
      void wx.showToast({ title: '手机号授权返回地址无效', icon: 'none' });
      return;
    }

    this.setData({ authorizationEnabled: true, returnUrl });
    this.controller = createPhoneAuthController({
      returnUrl,
      writeHandoff: app.phoneCredentialHandoff.write,
      navigateBack: (): void => {
        void wx.navigateBack();
      },
      toast: (title): void => {
        void wx.showToast({ title, icon: 'none' });
      },
    });
  },

  async onGetPhoneNumber(event): Promise<void> {
    if (!this.data.authorizationEnabled) return;
    if (this.data.flow === 'admin') {
      await this.adminController?.authorizePhone(event.detail.code);
      return;
    }
    this.controller?.handleAuthorization(event.detail);
  },

  onCancel(): void {
    void wx.navigateBack();
  },
});
