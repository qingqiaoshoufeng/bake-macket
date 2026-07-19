<script setup lang="ts">
defineProps<{
  totalCents: number;
  disabled: boolean;
  label: string;
}>();

defineEmits<{ (event: 'checkout'): void }>();
</script>

<template>
  <footer class="store-fixed-action checkout-bar">
    <div class="checkout-bar__summary">
      <small>商品合计</small>
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
.store-fixed-action { position: fixed; z-index: 15; right: max(var(--mall-page-gutter), calc(50% - 268px)); bottom: calc(var(--mall-tabbar-height) + var(--mall-space-5) + env(safe-area-inset-bottom)); left: max(var(--mall-page-gutter), calc(50% - 268px)); }
.checkout-bar { display: flex; min-height: 68px; padding: var(--mall-space-2) var(--mall-space-2) var(--mall-space-2) var(--mall-space-4); align-items: center; justify-content: space-between; gap: var(--mall-space-3); border-radius: var(--mall-radius-feature); background: var(--mall-text); color: #fff; box-shadow: var(--mall-shadow-floating); }
.checkout-bar__summary { display: flex; min-width: 0; flex-direction: column; }
.checkout-bar small { color: color-mix(in srgb, #fff 72%, var(--mall-primary)); font-size: 11px; }
.checkout-bar strong { font-size: 20px; line-height: 1.2; }
.store-primary-action { min-height: 44px; padding: 0 var(--mall-space-5); border: 0; border-radius: var(--mall-radius-card); background: var(--mall-accent); color: #3f332a; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
.store-primary-action:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 360px) { .store-primary-action { padding-inline: var(--mall-space-4); } }
</style>
