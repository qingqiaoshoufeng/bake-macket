<script setup lang="ts">
withDefaults(
  defineProps<{
    withTabbar?: boolean;
    withFixedAction?: boolean;
    compact?: boolean;
  }>(),
  {
    withTabbar: false,
    withFixedAction: false,
    compact: false,
  },
);
</script>

<template>
  <main
    class="store-page"
    :class="{
      'store-page--with-tabbar': withTabbar,
      'store-page--with-fixed-action': withFixedAction,
      'store-page--compact': compact,
    }"
  >
    <slot />
  </main>
</template>

<style scoped>
.store-page {
  width: 100%;
  max-width: var(--mall-page-width);
  min-height: 100%;
  margin: 0 auto;
  padding: var(--mall-space-5) var(--mall-page-gutter) var(--mall-space-8);
}

.store-page--compact {
  padding-top: var(--mall-space-3);
}

.store-page--with-tabbar {
  padding-bottom: calc(
    var(--mall-tabbar-height) + var(--mall-space-5) +
      env(safe-area-inset-bottom)
  );
}

.store-page--with-fixed-action {
  padding-bottom: calc(
    var(--mall-space-8) + var(--mall-space-8) + var(--mall-space-8) +
      env(safe-area-inset-bottom)
  );
}

.store-page--with-tabbar.store-page--with-fixed-action {
  padding-bottom: calc(
    var(--mall-tabbar-height) + var(--mall-space-8) + var(--mall-space-8) +
      var(--mall-space-8) + env(safe-area-inset-bottom)
  );
}
</style>
