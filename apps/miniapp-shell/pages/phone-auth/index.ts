import { MINIAPP_H5_ORIGIN } from '../../config/h5.generated.js';
import {
  createPhoneAuthController,
  resolvePhoneAuthReturnUrl,
} from '../../utils/bridge.js';
import type { BakeMallAppData } from '../../app.js';

const app = getApp<BakeMallAppData>();

type PhoneAuthPageData = Readonly<{
  authorizationEnabled: boolean;
  flow: 'h5';
  returnUrl: string;
}>;

type PhoneAuthPageCustom = {
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
    this.controller?.handleAuthorization(event.detail);
  },

  onCancel(): void {
    void wx.navigateBack();
  },
});
