<script setup lang="ts">
defineProps<{
  totalCents: number;
  disabled: boolean;
  label: string;
  allSelected: boolean;
}>();

defineEmits<{
  (event: 'select-all', selected: boolean): void;
  (event: 'checkout'): void;
}>();
</script>

<template>
  <footer class="store-fixed-action checkout-bar">
    <label class="checkout-bar__select" data-testid="select-all">
      <input
        data-testid="select-all-input"
        type="checkbox"
        :checked="allSelected"
        @change="
          $emit(
            'select-all',
            ($event.currentTarget as HTMLInputElement).checked,
          )
        "
      />
      <span aria-hidden="true" />
      全选
    </label>
    <div class="checkout-bar__summary">
      <small>已选合计</small>
      <strong>¥{{ (totalCents / 100).toFixed(2) }}</strong>
    </div>
    <button
      type="button"
      class="store-primary-action"
      data-testid="checkout"
      :disabled="disabled"
      :aria-disabled="disabled"
      @click="$emit('checkout')"
    >
      {{ label }}
    </button>
  </footer>
</template>

<style scoped>
.store-fixed-action {
  position: fixed;
  z-index: 15;
  right: max(var(--mall-page-gutter), calc(50% - 268px));
  bottom: calc(
    var(--mall-tabbar-height) + var(--mall-space-5) +
      env(safe-area-inset-bottom)
  );
  left: max(var(--mall-page-gutter), calc(50% - 268px));
}
.checkout-bar {
  display: flex;
  min-height: 68px;
  padding: var(--mall-space-2) var(--mall-space-2) var(--mall-space-2)
    var(--mall-space-4);
  align-items: center;
  justify-content: space-between;
  gap: var(--mall-space-3);
  border-radius: var(--mall-radius-feature);
  background: var(--mall-text);
  color: #fff;
  box-shadow: var(--mall-shadow-floating);
}
.checkout-bar__select {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  color: color-mix(in srgb, #fff 86%, var(--mall-primary));
  font-size: 13px;
  cursor: pointer;
}
.checkout-bar__select input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.checkout-bar__select > span {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 56%);
  border-radius: 50%;
  box-shadow: inset 0 0 0 3px var(--mall-text);
}
.checkout-bar__select input:checked + span {
  border-color: var(--mall-primary);
  background: var(--mall-primary);
}
.checkout-bar__select input:checked + span::after {
  width: 7px;
  height: 4px;
  border-bottom: 2px solid #fff;
  border-left: 2px solid #fff;
  content: '';
  transform: translateY(-1px) rotate(-45deg);
}
.checkout-bar__select input:focus-visible + span {
  outline: 3px solid rgb(255 255 255 / 28%);
  outline-offset: 2px;
}
.checkout-bar__summary {
  display: flex;
  min-width: 0;
  margin-left: auto;
  flex-direction: column;
  text-align: right;
}
.checkout-bar small {
  color: color-mix(in srgb, #fff 72%, var(--mall-primary));
  font-size: 11px;
}
.checkout-bar strong {
  font-size: 20px;
  line-height: 1.2;
}
.store-primary-action {
  min-height: 44px;
  padding: 0 var(--mall-space-5);
  border: 0;
  border-radius: var(--mall-radius-card);
  background: var(--mall-accent);
  color: #3f332a;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.store-primary-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (max-width: 390px) {
  .checkout-bar {
    gap: var(--mall-space-2);
  }
  .checkout-bar__select {
    gap: 6px;
    font-size: 12px;
  }
  .checkout-bar strong {
    font-size: 17px;
  }
  .store-primary-action {
    padding-inline: var(--mall-space-3);
  }
}
</style>
