<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';

import { apiClient } from './api/http.js';
import { useAdminAuthStore } from './stores/admin-auth.js';

const adminAuth = useAdminAuthStore();

onMounted(() => {
  // Hydrate the admin store before any route guard reads `requireAdminAuth`.
  // The unauthorized handler drops the admin session on 401 so the next
  // navigation guard funnels the merchant back to /login.
  adminAuth.hydrate();
  apiClient.onUnauthorized(() => adminAuth.clearSession());
});
</script>

<template>
  <RouterView />
</template>

<style>
@import './styles/theme.css';
</style>
