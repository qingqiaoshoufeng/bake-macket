<script setup lang="ts">
import type { OrderContactPhoneView } from '@bake-mall/contracts';

import { ORDER_CONTACT_PHONE_PATTERN } from '../config/order-contact-phone.js';

const props = defineProps<{
  contact: OrderContactPhoneView | null;
  editing: boolean;
  phone: string;
  saving: boolean;
  error: string | null;
}>();
const emit = defineEmits<{
  (event: 'edit'): void;
  (event: 'cancel'): void;
  (event: 'save'): void;
  (event: 'update:phone', value: string): void;
}>();

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
</script>

<template>
  <section class="profile-contact" aria-labelledby="order-contact-heading">
    <div class="profile-contact__heading">
      <div>
        <p>履约联系资料</p>
        <h2 id="order-contact-heading">订单联系手机号</h2>
      </div>
      <button
        v-if="!editing"
        type="button"
        class="profile-contact__link"
        data-testid="edit-order-contact-phone"
        @click="emit('edit')"
      >
        {{ contact?.configured ? '修改' : '设置' }}
      </button>
    </div>
    <p v-if="!editing" class="profile-contact__summary">
      <strong>{{
        contact?.configured ? contact.maskedPhone : '未配置'
      }}</strong>
      <span>仅用于订单取货或配送联系，不会成为登录身份手机号。</span>
    </p>
    <form v-else class="profile-contact__form" @submit.prevent="emit('save')">
      <label>
        <span>重新输入完整手机号</span>
        <input
          :value="props.phone"
          type="tel"
          inputmode="numeric"
          autocomplete="tel"
          maxlength="11"
          placeholder="11 位中国大陆手机号"
          data-testid="order-contact-phone-input"
          @input="emit('update:phone', inputValue($event))"
        />
      </label>
      <p v-if="error" class="profile-contact__error" role="alert">
        {{ error }}
      </p>
      <div class="profile-contact__actions">
        <button
          type="button"
          class="profile-contact__cancel"
          :disabled="saving"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          type="submit"
          class="profile-contact__save"
          :disabled="saving || !ORDER_CONTACT_PHONE_PATTERN.test(phone.trim())"
          data-testid="save-order-contact-phone"
        >
          {{ saving ? '保存中…' : '保存联系手机号' }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.profile-contact {
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.profile-contact__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mall-space-3);
}
.profile-contact__heading p,
.profile-contact__heading h2,
.profile-contact__summary,
.profile-contact__error {
  margin: 0;
}
.profile-contact__heading p {
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
}
.profile-contact__heading h2 {
  margin-top: 2px;
  font-size: 15px;
}
.profile-contact__link,
.profile-contact__cancel,
.profile-contact__save {
  min-height: 44px;
  border-radius: var(--mall-radius-control);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.profile-contact__link {
  padding: 0 var(--mall-space-3);
  border: 1px solid var(--mall-primary);
  background: var(--mall-surface);
  color: var(--mall-primary-strong);
}
.profile-contact__summary {
  display: grid;
  gap: var(--mall-space-1);
  margin-top: var(--mall-space-3);
}
.profile-contact__summary strong {
  color: var(--mall-text);
  font-size: 17px;
}
.profile-contact__summary span,
.profile-contact__form label > span {
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.6;
}
.profile-contact__form {
  display: grid;
  gap: var(--mall-space-3);
  margin-top: var(--mall-space-3);
}
.profile-contact__form label {
  display: grid;
  gap: var(--mall-space-1);
}
.profile-contact__form input {
  box-sizing: border-box;
  width: 100%;
  min-height: 46px;
  padding: 0 var(--mall-space-3);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-control);
  outline: none;
  background: var(--mall-canvas);
  color: var(--mall-text);
  font: inherit;
}
.profile-contact__form input:focus {
  border-color: var(--mall-primary);
  box-shadow: 0 0 0 3px rgb(120 162 129 / 18%);
}
.profile-contact__error {
  color: var(--mall-danger);
  font-size: 13px;
}
.profile-contact__actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--mall-space-2);
}
.profile-contact__cancel {
  border: 1px solid var(--mall-border);
  background: var(--mall-surface);
  color: var(--mall-text-muted);
}
.profile-contact__save {
  border: 0;
  background: var(--mall-primary);
  color: #fff;
}
.profile-contact__save:disabled,
.profile-contact__cancel:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
