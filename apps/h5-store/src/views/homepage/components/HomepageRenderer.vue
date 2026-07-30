<script setup lang="ts">
import type {
  HomepageLink,
  PublicHomepageConfig,
} from '@bake-mall/contracts';

import HomepageCarousel from './HomepageCarousel.vue';
import HomepageCustomerService from './HomepageCustomerService.vue';
import HomepageImageBlock from './HomepageImageBlock.vue';
import HomepageShortcutGrid from './HomepageShortcutGrid.vue';

defineProps<{
  readonly config: PublicHomepageConfig;
}>();

const emit = defineEmits<{
  navigate: [link: HomepageLink];
}>();
</script>

<template>
  <div class="homepage-renderer">
    <HomepageCarousel :section="config.hero" @navigate="emit('navigate', $event)" />
    <div class="homepage-renderer__content">
      <HomepageCustomerService :section="config.customerService" />
      <HomepageShortcutGrid
        :section="config.shortcutGrid"
        @navigate="emit('navigate', $event)"
      />
      <div v-if="config.imageBlocks.length" class="homepage-renderer__blocks">
        <HomepageImageBlock
          v-for="block in config.imageBlocks"
          :key="block.id"
          :block="block"
          @navigate="emit('navigate', $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.homepage-renderer__content {
  display: grid;
  gap: var(--mall-space-8);
  padding: var(--mall-space-6) var(--mall-page-gutter)
    calc(var(--mall-tabbar-height) + var(--mall-space-8) + env(safe-area-inset-bottom));
}

.homepage-renderer__blocks {
  display: grid;
  gap: var(--mall-space-4);
}
</style>
