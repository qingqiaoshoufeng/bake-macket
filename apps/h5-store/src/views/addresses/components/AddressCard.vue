<script setup lang="ts">
import type { AddressView } from '../type/index.js';

defineProps<{ address: AddressView }>();
defineEmits<{
  (event: 'default', address: AddressView): void;
  (event: 'edit', address: AddressView): void;
  (event: 'remove', address: AddressView): void;
}>();
</script>

<template>
  <li class="addresses__item" :data-testid="`address-${address.id}`">
    <div class="addresses__item-head"><span class="addresses__item-name">{{ address.recipient }} · {{ address.phone }}</span><span v-if="address.isDefault" class="addresses__item-badge">默认</span></div>
    <p class="addresses__item-text">{{ address.province }} {{ address.city }} {{ address.district }} {{ address.detail }}</p>
    <div class="addresses__item-actions">
      <button type="button" class="addresses__item-action" :disabled="address.isDefault" :aria-disabled="address.isDefault" :data-testid="`set-default-${address.id}`" @click="$emit('default', address)">{{ address.isDefault ? '已是默认' : '设为默认' }}</button>
      <button type="button" class="addresses__item-action" :data-testid="`edit-${address.id}`" @click="$emit('edit', address)">编辑</button>
      <button type="button" class="addresses__item-action addresses__item-action--danger" :data-testid="`remove-${address.id}`" @click="$emit('remove', address)">删除</button>
    </div>
  </li>
</template>

<style scoped>
.addresses__item { display: grid; gap: var(--mall-space-2); padding: var(--mall-space-4); border: 1px solid var(--mall-border); border-radius: var(--mall-radius-card); background: var(--mall-surface); box-shadow: var(--mall-shadow-card); }
.addresses__item-head { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: var(--mall-space-3); }
.addresses__item-name { min-width: 0; color: var(--mall-text); font-size: 14px; font-weight: 700; line-height: 1.5; }
.addresses__item-badge { padding: 3px 9px; flex: 0 0 auto; border-radius: 999px; background: var(--mall-surface-soft); color: var(--mall-primary-strong); font-size: 11px; font-weight: 700; }
.addresses__item-text { margin: 0; color: var(--mall-text-muted); font-size: 13px; line-height: 1.65; }
.addresses__item-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--mall-space-2); padding-top: var(--mall-space-2); border-top: 1px dashed var(--mall-border); }
.addresses__item-action { min-height: 44px; padding: 0 var(--mall-space-2); border: 1px solid var(--mall-border); border-radius: var(--mall-radius-control); background: var(--mall-surface); color: var(--mall-text); font: inherit; font-size: 12px; cursor: pointer; }
.addresses__item-action:disabled { background: var(--mall-canvas); color: var(--mall-text-muted); cursor: not-allowed; }
.addresses__item-action--danger { border-color: color-mix(in srgb, var(--mall-danger) 30%, var(--mall-border)); color: var(--mall-danger); }
@media (max-width: 350px) { .addresses__item-actions { grid-template-columns: 1fr; } }
</style>
