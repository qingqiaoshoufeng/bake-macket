<script setup lang="ts">
import { BannerTargetType, type BannerView } from '@bake-mall/contracts';

defineProps<{
  readonly banners: readonly BannerView[];
}>();

const emit = defineEmits<{
  open: [banner: BannerView];
}>();

function isInteractive(banner: BannerView): boolean {
  return banner.targetType !== BannerTargetType.NONE;
}

function frameAttributes(
  banner: BannerView,
): Readonly<Record<string, unknown>> {
  return isInteractive(banner)
    ? { type: 'button', onClick: () => emit('open', banner) }
    : {};
}
</script>

<template>
  <section v-if="banners.length" class="banner-reel" aria-label="推荐内容">
    <component
      :is="isInteractive(banner) ? 'button' : 'div'"
      v-for="banner in banners"
      :key="banner.id"
      v-bind="frameAttributes(banner)"
      class="banner-reel__frame"
      :class="{ 'banner-reel__frame--interactive': isInteractive(banner) }"
      :data-testid="`catalog-banner-${banner.id}`"
    >
      <img :src="banner.imageUrl" :alt="banner.title ?? '推荐烘焙'" />
      <span class="banner-reel__shade" aria-hidden="true" />
      <span class="banner-reel__title">
        {{ banner.title ?? '门店今日推荐' }}
      </span>
    </component>
  </section>
</template>

<style scoped>
.banner-reel {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 84%;
  gap: var(--mall-space-3);
  padding: 0 var(--mall-page-gutter) var(--mall-space-1);
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: none;
}

.banner-reel::-webkit-scrollbar {
  display: none;
}

.banner-reel__frame {
  position: relative;
  aspect-ratio: 16 / 8.5;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: var(--mall-radius-feature);
  background: var(--mall-surface-soft);
  box-shadow: var(--mall-shadow-card);
}

.banner-reel__frame--interactive {
  cursor: pointer;
}

.banner-reel img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.banner-reel__shade {
  position: absolute;
  inset: 36% 0 0;
  background: linear-gradient(transparent, rgb(23 38 27 / 66%));
}

.banner-reel__title {
  position: absolute;
  right: var(--mall-space-4);
  bottom: var(--mall-space-4);
  left: var(--mall-space-4);
  overflow: hidden;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
