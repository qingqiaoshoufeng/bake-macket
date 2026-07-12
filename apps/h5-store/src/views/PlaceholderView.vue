<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

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
  <section class="placeholder">
    <h1>{{ title }}</h1>
    <p>该模块将在后续任务中上线。</p>
  </section>
</template>

<style scoped>
.placeholder {
  padding: 24px 16px;
}
h1 {
  color: var(--mall-apricot);
  font-size: 20px;
  margin: 0 0 8px;
  text-transform: capitalize;
}
p {
  color: var(--mall-muted);
  font-size: 14px;
  margin: 0;
}
</style>
