import { computed, readonly, ref } from 'vue';

import { useAddressesStore } from '../../../stores/addresses.js';
import {
  captureSession,
  isCurrentSession,
  type SessionSnapshot,
} from '../../../stores/session.js';
import { addressesFeatureApi } from '../api/index.js';
import {
  ADDRESS_ERROR_DEFAULTS,
  ADDRESS_FORM_DEFAULTS,
  ADDRESS_PHONE_PATTERN,
} from '../config/defaults.js';
import type {
  AddressFormErrors,
  AddressFormValues,
  AddressView,
  CreateAddressRequest,
} from '../type/index.js';

function valuesFromAddress(address: AddressView | null): AddressFormValues {
  return address
    ? {
        receiverName: address.recipient,
        phone: address.phone,
        province: address.province,
        city: address.city,
        district: address.district,
        detail: address.detail,
        isDefault: address.isDefault,
      }
    : { ...ADDRESS_FORM_DEFAULTS };
}

export function validateAddress(
  values: Readonly<AddressFormValues>,
): AddressFormErrors {
  return {
    receiverName: !values.receiverName.trim()
      ? '请填写收货人姓名'
      : values.receiverName.length > 64
        ? '姓名最长 64 字'
        : null,
    phone: ADDRESS_PHONE_PATTERN.test(values.phone.trim())
      ? null
      : '请填写 11 位手机号',
    province: values.province.trim() ? null : '请填写省',
    city: values.city.trim() ? null : '请填写市',
    district: values.district.trim() ? null : '请填写区/县',
    detail: !values.detail.trim()
      ? '请填写详细地址'
      : values.detail.length > 256
        ? '详细地址最长 256 字'
        : null,
    isDefault: null,
  };
}

function mapAddressRequest(
  values: Readonly<AddressFormValues>,
): CreateAddressRequest {
  return {
    receiverName: values.receiverName.trim(),
    phone: values.phone.trim(),
    province: values.province.trim(),
    city: values.city.trim(),
    district: values.district.trim(),
    detail: values.detail.trim(),
    isDefault: values.isDefault,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useAddresses() {
  const addresses = useAddressesStore();
  const editing = ref<AddressView | null>(null);
  const formOpen = ref(false);
  const values = ref<AddressFormValues>({ ...ADDRESS_FORM_DEFAULTS });
  const errors = ref<AddressFormErrors>({ ...ADDRESS_ERROR_DEFAULTS });

  function resetForm(address: AddressView | null): void {
    values.value = valuesFromAddress(address);
    errors.value = { ...ADDRESS_ERROR_DEFAULTS };
  }

  function startCreate(): void {
    editing.value = null;
    formOpen.value = true;
    resetForm(null);
  }

  function startEdit(address: AddressView): void {
    editing.value = address;
    formOpen.value = true;
    resetForm(address);
  }

  function cancel(): void {
    editing.value = null;
    formOpen.value = false;
    resetForm(null);
  }

  function updateValues(next: Partial<AddressFormValues>): void {
    values.value = { ...values.value, ...next };
  }

  async function refresh(
    session: SessionSnapshot = captureSession(),
  ): Promise<AddressView[]> {
    addresses.setLoading(true);
    addresses.setError(null);
    try {
      const items = await addressesFeatureApi.list();
      if (isCurrentSession(session)) addresses.applyItems(items);
      return items;
    } catch (error) {
      if (isCurrentSession(session)) {
        addresses.setError(errorMessage(error, '加载失败'));
      }
      throw error;
    } finally {
      if (isCurrentSession(session)) addresses.setLoading(false);
    }
  }

  async function save<T>(
    operation: (session: SessionSnapshot) => Promise<T>,
  ): Promise<T> {
    const session = captureSession();
    addresses.setSaving(true);
    addresses.setError(null);
    try {
      return await operation(session);
    } catch (error) {
      if (isCurrentSession(session)) {
        addresses.setError(errorMessage(error, '保存失败'));
      }
      throw error;
    } finally {
      if (isCurrentSession(session)) addresses.setSaving(false);
    }
  }

  async function submit(): Promise<'created' | 'updated' | 'invalid'> {
    const nextErrors = validateAddress(values.value);
    errors.value = nextErrors;
    if (Object.values(nextErrors).some(Boolean)) return 'invalid';

    const payload = mapAddressRequest(values.value);
    const current = editing.value;
    await save(async (session) => {
      if (current) await addressesFeatureApi.update(current.id, payload);
      else await addressesFeatureApi.create(payload);
      if (isCurrentSession(session)) await refresh(session);
    });
    cancel();
    return current ? 'updated' : 'created';
  }

  async function setDefault(id: string): Promise<void> {
    await save(async (session) => {
      await addressesFeatureApi.setDefault(id);
      if (isCurrentSession(session)) await refresh(session);
    });
  }

  async function remove(id: string): Promise<void> {
    await save(async (session) => {
      await addressesFeatureApi.remove(id);
      if (isCurrentSession(session)) addresses.removeItem(id);
    });
  }

  return {
    data: {
      items: computed(() => addresses.items),
      editing: readonly(editing),
      formOpen: readonly(formOpen),
      values: readonly(values),
      errors: readonly(errors),
    },
    loading: computed(() => addresses.loading),
    saving: computed(() => addresses.saving),
    error: computed(() => addresses.lastError),
    methods: {
      refresh,
      startCreate,
      startEdit,
      cancel,
      updateValues,
      submit,
      setDefault,
      remove,
    },
  };
}
