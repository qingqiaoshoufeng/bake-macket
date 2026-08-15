<script setup lang="ts">
import type { OrderContactPhoneView } from '@bake-mall/contracts';

const props = defineProps<{
  contactName: string;
  orderContactPhone: OrderContactPhoneView | null;
}>();
const emit = defineEmits<{
  (event: 'update:contactName', value: string): void;
  (event: 'manage-contact-phone'): void;
}>();

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
</script>

<template>
  <section class="store-form-card checkout__contact">
    <div class="store-form-card__heading">
      <span>03</span>
      <div>
        <h2>订单联系人</h2>
        <p>订单联系手机号来自“我的”，提交时仅发送资料版本。</p>
      </div>
    </div>
    <label class="checkout__control"
      ><span>联系人</span
      ><input
        :value="props.contactName"
        type="text"
        maxlength="64"
        autocomplete="name"
        placeholder="联系人姓名"
        data-testid="contact-name"
        @input="emit('update:contactName', inputValue($event))"
    /></label>
    <div
      class="checkout__phone-summary"
      data-testid="order-contact-phone-summary"
    >
      <div>
        <span>订单联系手机号</span>
        <strong>{{
          orderContactPhone?.configured
            ? orderContactPhone.maskedPhone
            : '尚未设置'
        }}</strong>
      </div>
      <button
        type="button"
        data-testid="manage-order-contact-phone"
        @click="emit('manage-contact-phone')"
      >
        {{ orderContactPhone?.configured ? '去我的修改' : '去我的设置' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.store-form-card {
  margin: 0;
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.store-form-card__heading {
  display: flex;
  align-items: center;
  gap: var(--mall-space-2);
  color: var(--mall-text);
}
.store-form-card__heading > span {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 50%;
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 700;
}
.store-form-card__heading h2,
.store-form-card__heading p {
  margin: 0;
}
.store-form-card__heading h2 {
  font-size: 15px;
}
.store-form-card__heading p {
  margin-top: 2px;
  color: var(--mall-text-muted);
  font-size: 11px;
  line-height: 1.5;
}
.checkout__contact {
  display: grid;
  gap: var(--mall-space-3);
}
.checkout__control {
  display: grid;
  gap: var(--mall-space-1);
}
.checkout__control > span,
.checkout__phone-summary span {
  color: var(--mall-text-muted);
  font-size: 12px;
}
.checkout__control input {
  box-sizing: border-box;
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
.checkout__control input:focus {
  border-color: var(--mall-primary);
  box-shadow: 0 0 0 3px rgb(120 162 129 / 18%);
}
.checkout__phone-summary {
  display: flex;
  min-height: 64px;
  padding: var(--mall-space-3);
  align-items: center;
  justify-content: space-between;
  gap: var(--mall-space-3);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-control);
  background: var(--mall-canvas);
}
.checkout__phone-summary div {
  display: grid;
  gap: 2px;
}
.checkout__phone-summary strong {
  color: var(--mall-text);
  font-size: 15px;
}
.checkout__phone-summary button {
  min-height: 44px;
  padding: 0 var(--mall-space-3);
  border: 1px solid var(--mall-primary);
  border-radius: var(--mall-radius-control);
  background: var(--mall-surface);
  color: var(--mall-primary-strong);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
</style>
