import { computed, readonly, ref } from 'vue';
import {
  ApiErrorCode,
  type CustomerProfileView,
  type OrderContactPhoneView,
  type UserProfileView,
} from '@bake-mall/contracts';

import { ApiClientError } from '../../../api/http.js';
import { useAuthStore } from '../../../stores/auth.js';
import { captureSession, isCurrentSession } from '../../../stores/session.js';
import { profileFeatureApi } from '../api/index.js';
import { ORDER_CONTACT_PHONE_PATTERN } from '../config/order-contact-phone.js';

export type ProfileNotification = Readonly<{
  type: 'error' | 'success';
  message: string;
}>;

export function mapProfile(view: CustomerProfileView): UserProfileView {
  return {
    id: view.id,
    nickname: view.nickname ?? undefined,
    avatarUrl: view.avatarUrl ?? undefined,
    phone: view.phone ?? undefined,
    phoneVerified: view.phoneVerified,
    orderContactPhone: view.orderContactPhone,
  };
}

function applyOrderContactPhone(
  profile: UserProfileView,
  orderContactPhone: OrderContactPhoneView,
): UserProfileView {
  return { ...profile, orderContactPhone };
}

export function useProfile(
  notify: (notification: ProfileNotification) => void = () => undefined,
) {
  const auth = useAuthStore();
  const profile = ref<UserProfileView | null>(auth.profile ?? null);
  const loading = ref(false);
  const editingOrderContactPhone = ref(false);
  const orderContactPhoneInput = ref('');
  const savingOrderContactPhone = ref(false);
  const orderContactPhoneError = ref<string | null>(null);

  function applyProfile(next: UserProfileView): void {
    profile.value = next;
    auth.setProfile(next);
  }

  async function load(): Promise<UserProfileView> {
    const session = captureSession();
    loading.value = true;
    try {
      const next = mapProfile(await profileFeatureApi.get());
      if (isCurrentSession(session)) applyProfile(next);
      return next;
    } finally {
      if (isCurrentSession(session)) loading.value = false;
    }
  }

  function beginOrderContactPhoneEdit(): void {
    orderContactPhoneInput.value = '';
    orderContactPhoneError.value = null;
    editingOrderContactPhone.value = true;
  }

  function cancelOrderContactPhoneEdit(): void {
    orderContactPhoneInput.value = '';
    orderContactPhoneError.value = null;
    editingOrderContactPhone.value = false;
  }

  function updateOrderContactPhoneInput(value: string): void {
    orderContactPhoneInput.value = value;
    orderContactPhoneError.value = null;
  }

  async function reloadAfterConflict(): Promise<void> {
    await load();
    orderContactPhoneInput.value = '';
    orderContactPhoneError.value = '资料已在其他页面更新，请重新输入后保存';
    notify({ type: 'error', message: '联系手机号已刷新，请重新输入' });
  }

  async function saveOrderContactPhone(): Promise<boolean> {
    const current = profile.value?.orderContactPhone;
    const phone = orderContactPhoneInput.value.trim();
    if (!current) {
      orderContactPhoneError.value = '资料尚未加载，请稍后重试';
      return false;
    }
    if (!ORDER_CONTACT_PHONE_PATTERN.test(phone)) {
      orderContactPhoneError.value = '请输入 11 位中国大陆手机号';
      return false;
    }

    const session = captureSession();
    savingOrderContactPhone.value = true;
    orderContactPhoneError.value = null;
    try {
      const nextContact = await profileFeatureApi.updateOrderContactPhone({
        phone,
        expectedVersion: current.version,
      });
      if (!isCurrentSession(session) || !profile.value) return false;
      applyProfile(applyOrderContactPhone(profile.value, nextContact));
      orderContactPhoneInput.value = '';
      editingOrderContactPhone.value = false;
      notify({ type: 'success', message: '订单联系手机号已保存' });
      return true;
    } catch (error) {
      if (!isCurrentSession(session)) return false;
      if (
        error instanceof ApiClientError &&
        error.code === ApiErrorCode.ORDER_CONTACT_PHONE_UPDATE_VERSION_CONFLICT
      ) {
        await reloadAfterConflict();
        return false;
      }
      orderContactPhoneError.value =
        error instanceof Error ? error.message : '保存失败，请稍后重试';
      return false;
    } finally {
      if (isCurrentSession(session)) savingOrderContactPhone.value = false;
    }
  }

  function logout(): void {
    auth.clearSession();
    profile.value = null;
  }

  return {
    data: {
      profile,
      editingOrderContactPhone: readonly(editingOrderContactPhone),
      orderContactPhoneInput,
      orderContactPhoneError: readonly(orderContactPhoneError),
    },
    loading: computed(() => loading.value),
    savingOrderContactPhone: readonly(savingOrderContactPhone),
    methods: {
      load,
      logout,
      beginOrderContactPhoneEdit,
      cancelOrderContactPhoneEdit,
      updateOrderContactPhoneInput,
      saveOrderContactPhone,
    },
  };
}
