<script setup lang="ts">
import type { AddressFormErrors, AddressFormValues } from '../type/index.js';

const props = defineProps<{
  values: Readonly<AddressFormValues>;
  errors: AddressFormErrors;
  editing: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  (event: 'update', values: AddressFormValues): void;
  (event: 'submit'): void;
  (event: 'cancel'): void;
}>();

function update<K extends keyof AddressFormValues>(
  key: K,
  value: AddressFormValues[K],
): void {
  emit('update', { ...props.values, [key]: value });
}

function textValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}
</script>

<template>
  <form class="address-form store-form-card" @submit.prevent="emit('submit')">
    <div class="address-form__heading">
      <span>{{ editing ? '编辑地址' : '新增地址' }}</span
      ><small>收货信息</small>
    </div>
    <label class="address-form__field"
      ><span>收货人</span
      ><input
        :value="values.receiverName"
        type="text"
        maxlength="64"
        autocomplete="name"
        placeholder="收货人姓名"
        data-testid="receiver-name"
        @input="update('receiverName', textValue($event))"
      /><small v-if="errors.receiverName" class="address-form__error">{{
        errors.receiverName
      }}</small></label
    >
    <label class="address-form__field"
      ><span>手机号</span
      ><input
        :value="values.phone"
        type="tel"
        inputmode="numeric"
        maxlength="11"
        autocomplete="tel"
        placeholder="11 位手机号"
        data-testid="phone"
        @input="update('phone', textValue($event))"
      /><small v-if="errors.phone" class="address-form__error">{{
        errors.phone
      }}</small></label
    >
    <div class="address-form__row">
      <label class="address-form__field address-form__field--grow"
        ><span>省</span
        ><input
          :value="values.province"
          type="text"
          maxlength="64"
          placeholder="如:浙江省"
          data-testid="province"
          @input="update('province', textValue($event))"
        /><small v-if="errors.province" class="address-form__error">{{
          errors.province
        }}</small></label
      >
      <label class="address-form__field address-form__field--grow"
        ><span>市</span
        ><input
          :value="values.city"
          type="text"
          maxlength="64"
          placeholder="如:杭州市"
          data-testid="city"
          @input="update('city', textValue($event))"
        /><small v-if="errors.city" class="address-form__error">{{
          errors.city
        }}</small></label
      >
    </div>
    <label class="address-form__field"
      ><span>区/县</span
      ><input
        :value="values.district"
        type="text"
        maxlength="64"
        placeholder="如:西湖区"
        data-testid="district"
        @input="update('district', textValue($event))"
      /><small v-if="errors.district" class="address-form__error">{{
        errors.district
      }}</small></label
    >
    <label class="address-form__field"
      ><span>详细地址</span
      ><textarea
        :value="values.detail"
        rows="2"
        maxlength="256"
        placeholder="街道、门牌号等"
        data-testid="detail"
        @input="update('detail', textValue($event))"
      /><small v-if="errors.detail" class="address-form__error">{{
        errors.detail
      }}</small></label
    >
    <label class="address-form__toggle"
      ><input
        :checked="values.isDefault"
        type="checkbox"
        data-testid="is-default"
        @change="
          update('isDefault', ($event.target as HTMLInputElement).checked)
        "
      /><span>设为默认地址</span></label
    >
    <div class="address-form__actions">
      <button
        type="button"
        class="address-form__cancel"
        @click="emit('cancel')"
      >
        取消</button
      ><button
        type="submit"
        class="address-form__save"
        :disabled="saving"
        :aria-disabled="saving"
        data-testid="save"
      >
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.store-form-card {
  display: grid;
  gap: var(--mall-space-3);
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.address-form__heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mall-space-3);
}
.address-form__heading span {
  color: var(--mall-text);
  font-size: 16px;
  font-weight: 700;
}
.address-form__heading small {
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.address-form__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mall-space-3);
}
.address-form__field {
  display: grid;
  min-width: 0;
  gap: var(--mall-space-1);
}
.address-form__field > span {
  color: var(--mall-text-muted);
  font-size: 12px;
}
.address-form__field input,
.address-form__field textarea {
  width: 100%;
  min-height: 44px;
  padding: var(--mall-space-2) var(--mall-space-3);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-control);
  outline: none;
  background: var(--mall-canvas);
  color: var(--mall-text);
  font: inherit;
  font-size: 14px;
}
.address-form__field textarea {
  min-height: 76px;
  resize: vertical;
}
.address-form__field input:focus,
.address-form__field textarea:focus {
  border-color: var(--mall-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mall-primary) 14%, transparent);
}
.address-form__error {
  color: var(--mall-danger);
  font-size: 12px;
}
.address-form__toggle {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: var(--mall-space-2);
  color: var(--mall-text);
  font-size: 14px;
  cursor: pointer;
}
.address-form__toggle input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--mall-primary-strong);
}
.address-form__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mall-space-2);
}
.address-form__cancel,
.address-form__save {
  min-height: 44px;
  padding: 0 var(--mall-space-4);
  border: 0;
  border-radius: var(--mall-radius-control);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.address-form__cancel {
  background: var(--mall-canvas);
  color: var(--mall-text-muted);
}
.address-form__save {
  background: var(--mall-primary);
  color: #fff;
}
.address-form__save:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
@media (max-width: 340px) {
  .address-form__row {
    grid-template-columns: 1fr;
  }
}
</style>
