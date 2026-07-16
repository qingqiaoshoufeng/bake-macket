<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { Icon } from 'vant';

import { STORE_NAV_ITEMS } from '../config/navigation.js';

const route = useRoute();
const router = useRouter();

function isActive(path: string): boolean {
  return path === '/' ? route.path === '/' : route.path.startsWith(path);
}
</script>

<template>
  <nav class="store-tabbar" aria-label="商城主导航">
    <button
      v-for="item in STORE_NAV_ITEMS"
      :key="item.key"
      type="button"
      :class="['store-tabbar__item', isActive(item.path) && 'is-active']"
      @click="router.push(item.path)"
    >
      <Icon :name="item.icon" size="20" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.store-tabbar { position: fixed; left: 50%; bottom: 0; z-index: 20; width: min(100%, 560px); transform: translateX(-50%); display: grid; grid-template-columns: repeat(4, 1fr); padding: 8px max(10px, env(safe-area-inset-left)) calc(8px + env(safe-area-inset-bottom)); background: rgba(255,255,255,.94); border-top: 1px solid rgba(125,167,125,.16); backdrop-filter: blur(16px); }
.store-tabbar__item { display: flex; flex-direction: column; align-items: center; gap: 2px; border: 0; background: transparent; color: var(--mall-muted); font-size: 11px; }
.store-tabbar__item.is-active { color: #5d8c66; font-weight: 600; }
</style>
