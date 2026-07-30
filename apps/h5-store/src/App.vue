<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';

import { apiClient } from './api/http.js';
import StoreTabbar from './components/layout/StoreTabbar.vue';
import type { StoreTabbarKey } from './config/navigation.js';
import { useAuthStore } from './stores/auth.js';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const activeKey = computed(() => route.meta.tabbarKey as StoreTabbarKey | undefined);

onMounted(() => {
  // Hydrate the auth store before any component touches `requireVerifiedPhone`.
  auth.hydrate();
  // Forward 401s to the auth store so we drop the user session and the next
  // navigation falls into the route guard's `requiresAuth` branch.
  apiClient.onUnauthorized(() => auth.clearSession());
});
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
