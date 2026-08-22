import { MINIAPP_H5_ORIGIN } from '../../config/h5.generated.js';
import {
  createProfileCompletionApi,
  createProfileCompletionController,
  inspectAvatarFile,
} from '../../profile-completion/index.js';
import { resolveProfileCompletionReturnUrl } from '../../utils/bridge.js';
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

type ProfileCompletionPageData = Readonly<{
  avatarPreviewUrl: string;
  error: string;
  loading: boolean;
  nickname: string;
}>;

type ProfileCompletionPageCustom = {
  controller?: ReturnType<typeof createProfileCompletionController>;
  completed: boolean;
  onChooseAvatar: (
    event: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>,
  ) => Promise<void>;
  onNicknameChange: (
    event: WechatMiniprogram.CustomEvent<{ value?: string }>,
  ) => void;
  onSave: () => Promise<void>;
  onSkip: () => void;
};

Page<ProfileCompletionPageData, ProfileCompletionPageCustom>({
  completed: false,
  data: {
    avatarPreviewUrl: '',
    error: '',
    loading: true,
    nickname: '',
  },

  onLoad(query): void {
    const returnUrl = resolveProfileCompletionReturnUrl(
      query.returnUrl,
      MINIAPP_H5_ORIGIN,
    );
    if (!returnUrl) {
      this.setData({ error: '资料更新返回地址无效', loading: false });
      void wx.showToast({ title: '资料更新返回地址无效', icon: 'none' });
      return;
    }
    this.controller = createProfileCompletionController({
      applyCustomerSession: app.customerSession.set,
      applyProfile: (profile): void => {
        const current = app.customerSession.get();
        if (!current) return;
        app.customerSession.set({
          ...current,
          profile: {
            id: profile.id,
            nickname: profile.nickname ?? undefined,
            avatarUrl: profile.avatarUrl ?? undefined,
            phone: profile.phone ?? undefined,
            phoneVerified: profile.phoneVerified,
            profileCompleted: profile.profileCompleted,
            orderContactPhone: profile.orderContactPhone,
          },
        });
      },
      authenticate,
      inspectAvatar: inspectAvatarFile,
      navigateBack: (): void => {
        this.completed = true;
        void wx.navigateBack();
      },
      onStateChange: (state): void => {
        this.setData({
          avatarPreviewUrl: state.avatarPreviewUrl,
          error: state.error ?? '',
          loading: state.stage !== 'editing',
          nickname: state.nickname,
        });
      },
      presignAvatar: api.presignAvatar,
      returnUrl,
      updateProfile: api.updateProfile,
      uploadAvatar: api.uploadAvatar,
      writeOutcome: app.profileHandoff.write,
    });
    void this.controller.initialize();
  },

  onUnload(): void {
    if (!this.completed) this.controller?.handleSystemReturn();
  },

  async onChooseAvatar(event): Promise<void> {
    const avatarUrl = event.detail.avatarUrl?.trim();
    if (avatarUrl) await this.controller?.chooseAvatar(avatarUrl);
  },

  onNicknameChange(event): void {
    this.controller?.setNickname(event.detail.value ?? '');
  },

  async onSave(): Promise<void> {
    if (this.data.loading) return;
    await this.controller?.save();
  },

  onSkip(): void {
    if (this.data.loading) return;
    this.controller?.skip();
  },
});
