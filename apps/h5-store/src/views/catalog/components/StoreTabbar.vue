<script setup lang="ts">
import { Icon } from 'vant';

import { STORE_NAV_ITEMS } from '../config/navigation.js';

const props = defineProps<{ activePath: string }>();
const emit = defineEmits<{ (event: 'navigate', path: string): void }>();

function isActive(path: string): boolean {
  return path === '/'
    ? props.activePath === '/'
    : props.activePath.startsWith(path);
}
</script>

<template>
  <nav
    class="store-tabbar"
    aria-label="商城主导航"
    data-testid="store-tabbar"
  >
    <button
      v-for="item in STORE_NAV_ITEMS"
      :key="item.key"
      type="button"
      :class="['store-tabbar__item', isActive(item.path) && 'is-active']"
      :aria-current="isActive(item.path) ? 'page' : undefined"
      @click="emit('navigate', item.path)"
    >
      <Icon :name="item.icon" size="20" />
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
  grid-template-columns: repeat(4, 1fr);
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
  padding: var(--mall-space-1) var(--mall-space-2);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--mall-text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition:
    color 140ms ease,
    background 140ms ease;
}

.store-tabbar__item::before {
  position: absolute;
  top: 3px;
  width: 14px;
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

@media (prefers-reduced-motion: reduce) {
  .store-tabbar__item {
    transition: none;
  }
}
</style>
