<script setup lang="ts">
import {
  HomepageLinkType,
  type HomepageHeroSection,
  type HomepageLink,
} from '@bake-mall/contracts';
import { Swipe, SwipeItem } from 'vant';
import { computed, ref } from 'vue';

const props = defineProps<{
  readonly section: HomepageHeroSection<{ imageUrl: string }>;
}>();

const emit = defineEmits<{
  navigate: [link: HomepageLink];
}>();

const failedImages = ref<ReadonlySet<string>>(new Set());
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const autoplay = computed(() =>
  reducedMotion || props.section.slides.length <= 1 ? 0 : props.section.autoplayMs,
);

function markImageFailed(slideId: string): void {
  failedImages.value = new Set([...failedImages.value, slideId]);
}
</script>

<template>
  <section v-if="section.enabled" class="homepage-carousel" aria-label="首页轮播">
    <Swipe
      :autoplay="autoplay"
      :show-indicators="section.slides.length > 1"
      :loop="section.slides.length > 1"
      lazy-render
    >
      <SwipeItem v-for="slide in section.slides" :key="slide.id">
        <component
          :is="slide.link.type === HomepageLinkType.NONE ? 'div' : 'button'"
          :type="slide.link.type === HomepageLinkType.NONE ? undefined : 'button'"
          class="homepage-carousel__slide"
          @click="slide.link.type !== HomepageLinkType.NONE && emit('navigate', slide.link)"
        >
          <img
            v-if="!failedImages.has(slide.id)"
            :src="slide.image.imageUrl"
            :alt="slide.altText || slide.title"
            @error="markImageFailed(slide.id)"
          />
          <span v-else class="homepage-carousel__fallback">图片暂时无法显示</span>
          <span class="homepage-carousel__shade" aria-hidden="true" />
          <span
            v-if="slide.title || slide.subtitle"
            class="homepage-carousel__copy"
          >
            <strong>{{ slide.title }}</strong>
            <small>{{ slide.subtitle }}</small>
          </span>
        </component>
      </SwipeItem>
    </Swipe>
  </section>
</template>

<style scoped>
.homepage-carousel,
.homepage-carousel :deep(.van-swipe),
.homepage-carousel :deep(.van-swipe-item),
.homepage-carousel__slide {
  width: 100%;
  height: 100vh;
  height: 100svh;
  min-height: 520px;
}

@supports (height: 100dvh) {
  .homepage-carousel,
  .homepage-carousel :deep(.van-swipe),
  .homepage-carousel :deep(.van-swipe-item),
  .homepage-carousel__slide {
    height: 100dvh;
  }
}

.homepage-carousel__slide {
  position: relative;
  display: block;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: var(--mall-surface-soft);
  color: inherit;
  text-align: left;
}

button.homepage-carousel__slide {
  cursor: pointer;
}

.homepage-carousel__slide img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.homepage-carousel__fallback {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  background: linear-gradient(145deg, var(--mall-surface-soft), #f8eee4);
  color: var(--mall-text-muted);
  font-size: 13px;
}

.homepage-carousel__shade {
  position: absolute;
  inset: 38% 0 0;
  background: linear-gradient(transparent, rgb(25 44 31 / 72%));
}

.homepage-carousel__copy {
  position: absolute;
  right: var(--mall-page-gutter);
  bottom: calc(var(--mall-tabbar-height) + 52px + env(safe-area-inset-bottom));
  left: var(--mall-page-gutter);
  display: grid;
  gap: 6px;
  color: #fff;
}

.homepage-carousel__copy strong {
  font-size: clamp(28px, 9vw, 48px);
  letter-spacing: -0.04em;
  line-height: 1.08;
}

.homepage-carousel__copy small {
  max-width: 30em;
  font-size: 14px;
  line-height: 1.6;
}

.homepage-carousel :deep(.van-swipe__indicators) {
  bottom: calc(var(--mall-tabbar-height) + 30px + env(safe-area-inset-bottom));
}

.homepage-carousel :deep(.van-swipe__indicator) {
  background: #fff;
}

@media (prefers-reduced-motion: reduce) {
  .homepage-carousel :deep(.van-swipe__track) {
    transition: none !important;
  }
}
</style>
