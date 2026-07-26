<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import StorePage from '../components/layout/StorePage.vue';

/**
 * Generic placeholder for routes whose feature implementation lands in a
 * later task (catalog, cart, checkout, orders, addresses, profile). The view
 * displays the route name so the navigation shell is usable end-to-end and
 * the user gets a clear "coming soon" signal instead of a 404.
 */
const route = useRoute();
const title = computed(() => {
  const name = String(route.name ?? route.path ?? '');
  return name || '稍后开放';
});
</script>

<template>
  <StorePage class="placeholder">
    <StoreStatePanel
      state="empty"
      :title="title"
      description="该模块将在后续任务中上线。"
    />
  </StorePage>
</template>

<style scoped>
.placeholder {
  display: grid;
  min-height: 100%;
  place-items: center;
}

.placeholder :deep(.store-state-panel) {
  width: 100%;
  text-transform: capitalize;
}
</style>
