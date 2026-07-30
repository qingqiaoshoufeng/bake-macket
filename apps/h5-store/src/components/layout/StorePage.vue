<script setup lang="ts">
withDefaults(
  defineProps<{
    withTabbar?: boolean;
    withFixedAction?: boolean;
    compact?: boolean;
    fullBleed?: boolean;
  }>(),
  {
    withTabbar: false,
    withFixedAction: false,
    compact: false,
    fullBleed: false,
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
      'store-page--full-bleed': fullBleed,
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

.store-page--full-bleed {
  padding-top: 0;
  padding-right: 0;
  padding-left: 0;
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
