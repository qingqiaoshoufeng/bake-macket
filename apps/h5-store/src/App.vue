<script setup lang="ts">
import { computed } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';

import StoreTabbar from './components/layout/StoreTabbar.vue';
import type { StoreTabbarKey } from './config/navigation.js';

const route = useRoute();
const router = useRouter();
const activeKey = computed(
  () => route.meta.tabbarKey as StoreTabbarKey | undefined,
);
</script>

<template>
  <RouterView />
  <StoreTabbar
    v-if="route.meta.showTabbar && activeKey"
    :active-key="activeKey"
    @navigate="router.push"
  />
</template>

<style>
@import './styles/theme.css';
</style>
