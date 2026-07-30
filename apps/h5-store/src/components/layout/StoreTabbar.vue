<script setup lang="ts">
import { Icon } from 'vant';

import {
  STORE_NAV_ITEMS,
  type StoreTabbarKey,
} from '../../config/navigation.js';

defineProps<{ readonly activeKey: StoreTabbarKey }>();
const emit = defineEmits<{ navigate: [path: string] }>();
</script>

<template>
  <nav class="store-tabbar" aria-label="商城主导航" data-testid="store-tabbar">
    <button
      v-for="item in STORE_NAV_ITEMS"
      :key="item.key"
      type="button"
      :class="['store-tabbar__item', item.key === activeKey && 'is-active']"
      :aria-current="item.key === activeKey ? 'page' : undefined"
      @click="emit('navigate', item.path)"
    >
      <Icon :name="item.icon" size="19" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.store-tabbar {
  position: fixed;
  z-index: 20;
  right: max(var(--mall-page-gutter), calc(50% - 264px));
  bottom: calc(var(--mall-space-3) + env(safe-area-inset-bottom));
  left: max(var(--mall-page-gutter), calc(50% - 264px));
  display: grid;
  height: var(--mall-tabbar-height);
  grid-template-columns: repeat(5, minmax(0, 1fr));
  padding: var(--mall-space-2);
  border: 1px solid color-mix(in srgb, var(--mall-border) 86%, transparent);
  border-radius: 999px;
  background: rgb(255 255 255 / 94%);
  box-shadow: var(--mall-shadow-floating);
  backdrop-filter: blur(16px);
}

.store-tabbar__item {
  position: relative;
  display: flex;
  min-width: 0;
  padding: var(--mall-space-1) 3px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--mall-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  white-space: nowrap;
  transition:
    color 140ms ease,
    background 140ms ease;
}

.store-tabbar__item::before {
  position: absolute;
  top: 3px;
  width: 13px;
  height: 3px;
  border-radius: 999px;
  background: transparent;
  content: '';
}

.store-tabbar__item.is-active {
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font-weight: 700;
}

.store-tabbar__item.is-active::before {
  background: var(--mall-primary);
}

@media (max-width: 360px) {
  .store-tabbar {
    right: 8px;
    left: 8px;
    padding: 6px;
  }

  .store-tabbar__item {
    padding-inline: 1px;
    font-size: 9px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .store-tabbar__item {
    transition: none;
  }
}
</style>
