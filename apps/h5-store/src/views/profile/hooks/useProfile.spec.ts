import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorCode } from '@bake-mall/contracts';

import { ApiClientError } from '../../../api/http.js';
import { useAuthStore } from '../../../stores/auth.js';
import { profileFeatureApi } from '../api/index.js';
import { useProfile } from './useProfile.js';

vi.mock('../api/index.js', () => ({
  profileFeatureApi: {
    get: vi.fn(),
    updateOrderContactPhone: vi.fn(),
  },
}));

const canonicalProfile = {
  id: 'user-1',
  nickname: '微信顾客',
  avatarUrl: null,
  phone: '138****0000',
  phoneVerified: true,
  orderContactPhone: {
    configured: true as const,
    maskedPhone: '139****0000',
    version: 2,
  },
};

function mountProfile(notify = vi.fn()) {
  let profile!: ReturnType<typeof useProfile>;
  const wrapper = mount({
    setup() {
      profile = useProfile(notify);
      return {};
    },
    template: '<div />',
  });
  return { notify, profile, wrapper };
}

describe('useProfile', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(profileFeatureApi.get).mockResolvedValue(canonicalProfile);
  });

  it('GET /me 的 phoneVerified 与订单联系状态覆盖本地猜测', async () => {
    const auth = useAuthStore();
    auth.profile = {
      id: 'user-1',
      phoneVerified: false,
      orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
    };
    const { profile } = mountProfile();

    await profile.methods.load();

    expect(profile.data.profile.value).toEqual({
      id: canonicalProfile.id,
      nickname: canonicalProfile.nickname,
      avatarUrl: undefined,
      phone: canonicalProfile.phone,
      phoneVerified: true,
      orderContactPhone: canonicalProfile.orderContactPhone,
    });
  });

  it('保存时发送 expectedVersion，成功后仅保留脱敏状态并清空输入', async () => {
    vi.mocked(profileFeatureApi.updateOrderContactPhone).mockResolvedValue({
      configured: true,
      maskedPhone: '137****8888',
      version: 3,
    });
    const { profile } = mountProfile();
    await profile.methods.load();
    profile.methods.beginOrderContactPhoneEdit();
    profile.methods.updateOrderContactPhoneInput('13700008888');

    await expect(profile.methods.saveOrderContactPhone()).resolves.toBe(true);

    expect(profileFeatureApi.updateOrderContactPhone).toHaveBeenCalledWith({
      phone: '13700008888',
      expectedVersion: 2,
    });
    expect(profile.data.profile.value?.orderContactPhone).toEqual({
      configured: true,
      maskedPhone: '137****8888',
      version: 3,
    });
    expect(profile.data.orderContactPhoneInput.value).toBe('');
    expect(window.localStorage.getItem('bake_user_profile')).not.toContain(
      '13700008888',
    );
  });

  it('版本冲突时 reload 权威资料并要求重新输入', async () => {
    vi.mocked(profileFeatureApi.updateOrderContactPhone).mockRejectedValue(
      new ApiClientError(409, 'version conflict', {
        code: ApiErrorCode.ORDER_CONTACT_PHONE_UPDATE_VERSION_CONFLICT,
      }),
    );
    vi.mocked(profileFeatureApi.get)
      .mockResolvedValueOnce(canonicalProfile)
      .mockResolvedValueOnce({
        ...canonicalProfile,
        orderContactPhone: {
          configured: true,
          maskedPhone: '136****6666',
          version: 3,
        },
      });
    const { notify, profile } = mountProfile();
    await profile.methods.load();
    profile.methods.beginOrderContactPhoneEdit();
    profile.methods.updateOrderContactPhoneInput('13700008888');

    await expect(profile.methods.saveOrderContactPhone()).resolves.toBe(false);

    expect(profileFeatureApi.get).toHaveBeenCalledTimes(2);
    expect(profile.data.profile.value?.orderContactPhone.version).toBe(3);
    expect(profile.data.orderContactPhoneInput.value).toBe('');
    expect(notify).toHaveBeenCalledWith({
      type: 'error',
      message: '联系手机号已刷新，请重新输入',
    });
  });
});
