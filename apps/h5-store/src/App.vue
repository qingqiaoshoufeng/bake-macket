<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';

import { apiClient } from './api/http.js';
import { useAuthStore } from './stores/auth.js';

const auth = useAuthStore();

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
</template>

<style>
@import './styles/theme.css';
</style>
