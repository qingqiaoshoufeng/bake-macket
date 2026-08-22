import { MINIAPP_H5_ORIGIN } from '../../config/h5.generated.js';
import { createWechatLoginProfileController } from '../../login/hooks/login-profile.js';
import {
  createProfileCompletionApi,
  inspectAvatarFile,
} from '../../profile-completion/index.js';
import { resolveWechatLoginReturnUrl } from '../../utils/bridge.js';
import type { BakeMallAppData } from '../../app.js';

const app = getApp<BakeMallAppData>();
const api = createProfileCompletionApi(app);

function freshWechatLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }): void => resolve(code),
      fail: reject,
    });
  });
}

async function authenticate() {
  const code = (await freshWechatLogin()).trim();
  if (!code) throw new Error('微信登录失败，请稍后重试');
  return api.loginWithWechat(code);
}

type WechatLoginPageData = Readonly<{
  avatarPreviewUrl: string;
  error: string;
  loginEnabled: boolean;
  loginLoading: boolean;
  nickname: string;
  showProfileForm: boolean;
}>;

type WechatLoginPageCustom = {
  controller?: ReturnType<typeof createWechatLoginProfileController>;
  onCancel: () => void;
  onChooseAvatar: (
    event: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>,
  ) => Promise<void>;
  onNicknameChange: (
    event: WechatMiniprogram.CustomEvent<{ value?: string }>,
  ) => void;
  onSave: () => Promise<void>;
  onSkip: () => Promise<void>;
  onWechatLogin: () => Promise<void>;
};

Page<WechatLoginPageData, WechatLoginPageCustom>({
  data: {
    avatarPreviewUrl: '',
    error: '',
    loginEnabled: false,
    loginLoading: false,
    nickname: '',
    showProfileForm: false,
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

    this.controller = createWechatLoginProfileController({
      applyCustomerSession: app.customerSession.set,
      authenticate,
      inspectAvatar: inspectAvatarFile,
      navigateBack: (): void => {
        void wx.navigateBack();
      },
      onStateChange: (profileState): void => {
        this.setData({
          avatarPreviewUrl: profileState.avatarPreviewUrl,
          error: profileState.error ?? '',
          loginEnabled: profileState.stage === 'ready',
          loginLoading: !['editing', 'ready'].includes(profileState.stage),
          nickname: profileState.nickname,
          showProfileForm: profileState.stage === 'editing',
        });
      },
      presignAvatar: api.presignAvatar,
      requestFreshCode: freshWechatLogin,
      returnUrl,
      state,
      updateProfile: api.updateProfile,
      uploadAvatar: api.uploadAvatar,
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
    await this.controller.start();
  },

  async onChooseAvatar(event): Promise<void> {
    const avatarUrl = event.detail.avatarUrl?.trim();
    if (avatarUrl) await this.controller?.chooseAvatar(avatarUrl);
  },

  onNicknameChange(event): void {
    this.controller?.setNickname(event.detail.value ?? '');
  },

  async onSave(): Promise<void> {
    if (this.data.loginLoading) return;
    await this.controller?.save();
  },

  async onSkip(): Promise<void> {
    if (this.data.loginLoading) return;
    await this.controller?.skip();
  },

  onCancel(): void {
    void wx.navigateBack();
  },
});
