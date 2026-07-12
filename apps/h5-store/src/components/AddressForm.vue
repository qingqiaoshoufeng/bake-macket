<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { showToast } from 'vant';

import type {
  AddressView,
  CreateAddressRequest,
  UpdateAddressRequest,
} from '../api/customer.js';

type AddressFormValues = {
  receiverName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  isDefault: boolean;
};

/**
 * Address book form used by `AddressesView` for both create and edit.
 *
 * Validation rules mirror the server-side constraints in
 * `apps/api/src/customer/dto/address.dto.ts`:
 *
 * - `receiverName`, `province`, `city`, `district`, `detail` — non-empty
 *   after trim, max 64 chars (256 for `detail`).
 * - `phone` — exactly 11 digits, starting with `1`.
 *
 * The form's `submit` event fires only when validation passes; the parent
 * decides whether to POST or PATCH.
 */
const props = defineProps<{
  initial?: AddressView | null;
  saving?: boolean;
}>();

const emit = defineEmits<{
  (event: 'submit', payload: CreateAddressRequest | UpdateAddressRequest): void;
  (event: 'cancel'): void;
}>();

const PHONE_PATTERN = /^1\d{10}$/;

const values = reactive<AddressFormValues>({
  receiverName: props.initial?.recipient ?? '',
  phone: props.initial?.phone ?? '',
  province: props.initial?.province ?? '',
  city: props.initial?.city ?? '',
  district: props.initial?.district ?? '',
  detail: props.initial?.detail ?? '',
  isDefault: props.initial?.isDefault ?? false,
});

const errors = reactive<Record<keyof AddressFormValues, string | null>>({
  receiverName: null,
  phone: null,
  province: null,
  city: null,
  district: null,
  detail: null,
  isDefault: null,
});

const submitting = computed(() => Boolean(props.saving));

watch(
  () => props.initial,
  (next) => {
    if (!next) return;
    values.receiverName = next.recipient;
    values.phone = next.phone;
    values.province = next.province;
    values.city = next.city;
    values.district = next.district;
    values.detail = next.detail;
    values.isDefault = next.isDefault;
  },
);

function validate(): boolean {
  let ok = true;
  if (!values.receiverName.trim()) {
    errors.receiverName = '请填写收货人姓名';
    ok = false;
  } else if (values.receiverName.length > 64) {
    errors.receiverName = '姓名最长 64 字';
    ok = false;
  } else {
    errors.receiverName = null;
  }
  if (!PHONE_PATTERN.test(values.phone.trim())) {
    errors.phone = '请填写 11 位手机号';
    ok = false;
  } else {
    errors.phone = null;
  }
  if (!values.province.trim()) {
    errors.province = '请填写省';
    ok = false;
  } else {
    errors.province = null;
  }
  if (!values.city.trim()) {
    errors.city = '请填写市';
    ok = false;
  } else {
    errors.city = null;
  }
  if (!values.district.trim()) {
    errors.district = '请填写区/县';
    ok = false;
  } else {
    errors.district = null;
  }
  if (!values.detail.trim()) {
    errors.detail = '请填写详细地址';
    ok = false;
  } else if (values.detail.length > 256) {
    errors.detail = '详细地址最长 256 字';
    ok = false;
  } else {
    errors.detail = null;
  }
  return ok;
}

const submittingRef = ref(false);

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  if (!validate()) {
    showToast('请检查表单填写');
    return;
  }
  submittingRef.value = true;
  try {
    const payload: CreateAddressRequest = {
      receiverName: values.receiverName.trim(),
      phone: values.phone.trim(),
      province: values.province.trim(),
      city: values.city.trim(),
      district: values.district.trim(),
      detail: values.detail.trim(),
      isDefault: values.isDefault,
    };
    emit('submit', payload);
  } finally {
    submittingRef.value = false;
  }
}
</script>

<template>
  <form class="address-form" @submit.prevent="onSubmit">
    <label class="address-form__field">
      <span>收货人</span>
      <input
        v-model="values.receiverName"
        type="text"
        maxlength="64"
        autocomplete="name"
        placeholder="收货人姓名"
        data-testid="receiver-name"
      />
      <small v-if="errors.receiverName" class="address-form__error">
        {{ errors.receiverName }}
      </small>
    </label>

    <label class="address-form__field">
      <span>手机号</span>
      <input
        v-model="values.phone"
        type="tel"
        inputmode="numeric"
        maxlength="11"
        autocomplete="tel"
        placeholder="11 位手机号"
        data-testid="phone"
      />
      <small v-if="errors.phone" class="address-form__error">
        {{ errors.phone }}
      </small>
    </label>

    <div class="address-form__row">
      <label class="address-form__field address-form__field--grow">
        <span>省</span>
        <input
          v-model="values.province"
          type="text"
          maxlength="64"
          placeholder="如:浙江省"
          data-testid="province"
        />
        <small v-if="errors.province" class="address-form__error">
          {{ errors.province }}
        </small>
      </label>
      <label class="address-form__field address-form__field--grow">
        <span>市</span>
        <input
          v-model="values.city"
          type="text"
          maxlength="64"
          placeholder="如:杭州市"
          data-testid="city"
        />
        <small v-if="errors.city" class="address-form__error">
          {{ errors.city }}
        </small>
      </label>
    </div>

    <label class="address-form__field">
      <span>区/县</span>
      <input
        v-model="values.district"
        type="text"
        maxlength="64"
        placeholder="如:西湖区"
        data-testid="district"
      />
      <small v-if="errors.district" class="address-form__error">
        {{ errors.district }}
      </small>
    </label>

    <label class="address-form__field">
      <span>详细地址</span>
      <textarea
        v-model="values.detail"
        rows="2"
        maxlength="256"
        placeholder="街道、门牌号等"
        data-testid="detail"
      />
      <small v-if="errors.detail" class="address-form__error">
        {{ errors.detail }}
      </small>
    </label>

    <label class="address-form__toggle">
      <input
        v-model="values.isDefault"
        type="checkbox"
        data-testid="is-default"
      />
      <span>设为默认地址</span>
    </label>

    <div class="address-form__actions">
      <button
        type="button"
        class="address-form__cancel"
        @click="emit('cancel')"
      >
        取消
      </button>
      <button
        type="submit"
        class="address-form__save"
        :disabled="submitting"
        data-testid="save"
      >
        {{ submitting ? '保存中…' : '保存' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.address-form {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 1px 3px rgba(143, 181, 143, 0.08);
}
.address-form__row {
  display: flex;
  gap: 12px;
}
.address-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.address-form__field--grow {
  flex: 1;
}
.address-form__field > span {
  color: var(--mall-muted);
  font-size: 12px;
}
.address-form__field input,
.address-form__field textarea {
  border: 1px solid #e7e2d8;
  border-radius: var(--van-radius-md);
  padding: 8px 10px;
  font-size: 14px;
  outline: none;
  background: #fff;
  color: var(--mall-ink);
  font-family: inherit;
  resize: vertical;
}
.address-form__field input:focus,
.address-form__field textarea:focus {
  border-color: var(--mall-leaf);
}
.address-form__error {
  color: #c14d4d;
  font-size: 12px;
}
.address-form__toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--mall-ink);
}
.address-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.address-form__cancel,
.address-form__save {
  height: 40px;
  border-radius: var(--van-radius-lg);
  border: 0;
  padding: 0 18px;
  font-size: 14px;
  cursor: pointer;
}
.address-form__cancel {
  background: #f3eee3;
  color: var(--mall-muted);
}
.address-form__save {
  background: var(--van-primary-color);
  color: #fff;
}
.address-form__save[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
