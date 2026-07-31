<script setup lang="ts">
import {
  HomepageLinkType,
  type HomepageDraftConfig,
  type HomepageLink,
} from '@bake-mall/contracts';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { INTERNAL_PAGE_OPTIONS } from '../config/options.js';

const props = defineProps<{
  readonly draft: HomepageDraftConfig;
}>();

const PREVIEW_WIDTH = 390;
const PREVIEW_HEIGHT = 844;

const activeSlide = ref(0);
const screen = ref<HTMLElement | null>(null);
const canvas = ref<HTMLElement | null>(null);
const previewScale = ref(1);
const canvasContentHeight = ref(PREVIEW_HEIGHT);
let previewObserver: ResizeObserver | null = null;
const canvasStyle = computed(() => ({
  width: `${PREVIEW_WIDTH}px`,
  transform: `scale(${previewScale.value})`,
}));
const canvasHeight = computed(
  () => `${canvasContentHeight.value * previewScale.value}px`,
);
const visibleBlocks = computed(() =>
  props.draft.imageBlocks.filter(({ enabled }) => enabled),
);
const currentSlide = computed(
  () => props.draft.hero.slides[activeSlide.value] ?? null,
);

function keepActiveSlideInRange(length: number): void {
  if (activeSlide.value >= length) {
    activeSlide.value = Math.max(0, length - 1);
  }
}

watch(() => props.draft.hero.slides.length, keepActiveSlideInRange);

function updatePreviewMetrics(): void {
  if (screen.value) {
    previewScale.value = Math.min(1, screen.value.clientWidth / PREVIEW_WIDTH);
  }
  if (canvas.value) {
    canvasContentHeight.value = Math.max(
      PREVIEW_HEIGHT,
      canvas.value.scrollHeight,
    );
  }
}

onMounted(() => {
  updatePreviewMetrics();
  if (typeof ResizeObserver === 'undefined') return;
  previewObserver = new ResizeObserver(updatePreviewMetrics);
  if (screen.value) previewObserver.observe(screen.value);
  if (canvas.value) previewObserver.observe(canvas.value);
});

onBeforeUnmount(() => previewObserver?.disconnect());

function linkText(link: HomepageLink): string {
  if (link.type === HomepageLinkType.NONE) return '无跳转';
  if (link.type === HomepageLinkType.PRODUCT) return `商品 #${link.targetId}`;
  if (link.type === HomepageLinkType.CATEGORY) return `分类 #${link.targetId}`;
  return (
    INTERNAL_PAGE_OPTIONS.find(({ value }) => value === link.page)?.label ??
    link.page
  );
}
</script>

<template>
  <aside class="homepage-phone-preview" aria-label="首页手机实时预览">
    <header>
      <span>LIVE HOMEPAGE</span>
      <small>预览中的链接不会离开后台</small>
    </header>
    <div
      class="homepage-phone-preview__device"
      data-preview-device
      data-aspect="390/844"
    >
      <div
        ref="screen"
        class="homepage-phone-preview__screen"
        data-preview-screen
      >
        <div
          class="homepage-phone-preview__canvas-space"
          :style="{ height: canvasHeight }"
        >
          <div
            ref="canvas"
            class="homepage-phone-preview__canvas"
            data-preview-canvas
            data-width="390"
            data-height="844"
            :style="canvasStyle"
          >
            <section
              v-if="draft.hero.enabled"
              class="homepage-phone-preview__hero"
            >
              <img
                v-if="currentSlide?.image"
                :src="currentSlide.image.publicUrl"
                :alt="currentSlide.altText || '轮播预览'"
              />
              <div v-else class="homepage-phone-preview__placeholder">
                首屏轮播占位
              </div>
              <div
                v-if="currentSlide"
                class="homepage-phone-preview__hero-copy"
              >
                <strong>{{ currentSlide.title || '轮播标题' }}</strong>
                <span>{{
                  currentSlide.subtitle || linkText(currentSlide.link)
                }}</span>
              </div>
              <div
                v-if="draft.hero.slides.length > 1"
                class="homepage-phone-preview__dots"
              >
                <button
                  v-for="(slide, index) in draft.hero.slides"
                  :key="slide.id"
                  type="button"
                  :class="{ 'is-active': index === activeSlide }"
                  :aria-label="`查看轮播图 ${index + 1}`"
                  @click="activeSlide = index"
                />
              </div>
            </section>

            <div class="homepage-phone-preview__body">
              <section
                v-if="draft.customerService.enabled"
                class="homepage-phone-preview__service"
              >
                <div>
                  <small>BAKER SERVICE</small>
                  <h3>{{ draft.customerService.title || '联系客服' }}</h3>
                  <p>
                    {{ draft.customerService.description || '客服说明占位' }}
                  </p>
                  <strong>{{
                    draft.customerService.phone || '客服电话未填写'
                  }}</strong>
                  <span>{{
                    draft.customerService.serviceHours || '服务时间未填写'
                  }}</span>
                </div>
                <img
                  v-if="draft.customerService.wechatQrCode"
                  :src="draft.customerService.wechatQrCode.publicUrl"
                  alt="客服二维码预览"
                />
                <div v-else class="homepage-phone-preview__qr">二维码</div>
              </section>

              <section v-if="draft.shortcutGrid.enabled">
                <h3>{{ draft.shortcutGrid.title || '快捷入口' }}</h3>
                <div
                  class="homepage-phone-preview__grid"
                  :data-layout="draft.shortcutGrid.layout"
                >
                  <article
                    v-for="item in draft.shortcutGrid.items"
                    :key="item.id"
                  >
                    <img v-if="item.image" :src="item.image.publicUrl" alt="" />
                    <div v-else class="homepage-phone-preview__icon">图</div>
                    <strong>{{ item.label || '入口名称' }}</strong>
                    <span>{{ linkText(item.link) }}</span>
                  </article>
                </div>
              </section>

              <article
                v-for="block in visibleBlocks"
                :key="block.id"
                class="homepage-phone-preview__image-block"
              >
                <img
                  v-if="block.image"
                  :src="block.image.publicUrl"
                  :alt="block.altText"
                />
                <div v-else class="homepage-phone-preview__placeholder">
                  配图占位
                </div>
                <div>
                  <strong>{{ block.title || '配图标题' }}</strong>
                  <p>{{ block.description || linkText(block.link) }}</p>
                </div>
              </article>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.homepage-phone-preview {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  overflow: hidden;
}

.homepage-phone-preview > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--admin-muted);
  font-size: 11px;
}

.homepage-phone-preview > header span {
  color: var(--admin-mint);
  font-weight: 800;
  letter-spacing: 0.14em;
}

.homepage-phone-preview__device {
  position: relative;
  width: auto;
  max-width: min(100%, 390px);
  height: min(100%, 844px);
  aspect-ratio: 390 / 844;
  margin: 0 auto;
  padding: 7px;
  overflow: hidden;
  border: 1px solid
    color-mix(in srgb, var(--admin-mint) 44%, var(--admin-border));
  border-radius: 34px;
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--admin-surface) 84%, #d8eee4),
    color-mix(in srgb, var(--admin-surface-soft) 82%, #f8e9dc)
  );
  box-shadow:
    0 22px 46px rgb(103 137 121 / 18%),
    inset 0 0 0 5px color-mix(in srgb, var(--admin-surface) 90%, transparent);
}

.homepage-phone-preview__device::before {
  position: absolute;
  z-index: 2;
  top: 13px;
  left: 50%;
  width: 24%;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--admin-mint) 30%, var(--admin-border));
  content: '';
  pointer-events: none;
  transform: translateX(-50%);
}

.homepage-phone-preview__screen {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid color-mix(in srgb, var(--admin-border) 74%, transparent);
  border-radius: 27px;
  background: #fffaf5;
  scrollbar-color: color-mix(in srgb, var(--admin-mint) 46%, transparent)
    transparent;
  scrollbar-width: thin;
}

.homepage-phone-preview__screen::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.homepage-phone-preview__screen::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--admin-mint) 46%, transparent);
}

.homepage-phone-preview__canvas-space {
  position: relative;
  width: 100%;
}

.homepage-phone-preview__canvas {
  position: absolute;
  top: 0;
  left: 0;
  min-height: 844px;
  overflow: hidden;
  background: #fffaf5;
  transform-origin: top left;
}

.homepage-phone-preview__hero {
  position: relative;
  min-height: 100%;
  aspect-ratio: 390 / 844;
  overflow: hidden;
  background: #eee8f1;
}

.homepage-phone-preview__hero > img,
.homepage-phone-preview__image-block > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.homepage-phone-preview__hero-copy {
  position: absolute;
  right: 18px;
  bottom: 30px;
  left: 18px;
  display: grid;
  gap: 5px;
  color: #fff;
  text-shadow: 0 2px 12px rgb(0 0 0 / 45%);
}

.homepage-phone-preview__hero-copy strong {
  font-size: 23px;
}

.homepage-phone-preview__dots {
  position: absolute;
  right: 0;
  bottom: 12px;
  left: 0;
  display: flex;
  justify-content: center;
  gap: 5px;
}

.homepage-phone-preview__dots button {
  width: 7px;
  height: 7px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgb(255 255 255 / 48%);
}

.homepage-phone-preview__dots button.is-active {
  width: 18px;
  border-radius: 999px;
  background: #fff;
}

.homepage-phone-preview__body {
  display: grid;
  gap: 22px;
  padding: 20px 16px 86px;
}

.homepage-phone-preview__body h3,
.homepage-phone-preview__body p {
  margin: 0;
}

.homepage-phone-preview__service {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px;
  gap: 14px;
  padding: 16px;
  border-radius: 18px;
  background: #f2ecf4;
}

.homepage-phone-preview__service > div:first-child {
  display: grid;
  gap: 5px;
}

.homepage-phone-preview__service small {
  color: #816e97;
  font-weight: 800;
  letter-spacing: 0.11em;
}

.homepage-phone-preview__service p,
.homepage-phone-preview__service span {
  color: #766d79;
  font-size: 11px;
}

.homepage-phone-preview__service img,
.homepage-phone-preview__qr {
  width: 88px;
  aspect-ratio: 1;
  border-radius: 10px;
  object-fit: contain;
}

.homepage-phone-preview__qr,
.homepage-phone-preview__icon,
.homepage-phone-preview__placeholder {
  display: grid;
  place-items: center;
  background: #e8dfe9;
  color: #8c7e90;
  font-size: 11px;
}

.homepage-phone-preview__placeholder {
  min-height: 180px;
}

.homepage-phone-preview__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 8px;
  margin-top: 12px;
}

.homepage-phone-preview__grid[data-layout='4'] {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.homepage-phone-preview__grid[data-layout='5'] article:nth-child(4) {
  grid-column: 1 / 2;
  transform: translateX(50%);
}

.homepage-phone-preview__grid[data-layout='5'] article:nth-child(5) {
  grid-column: 2 / 3;
  transform: translateX(50%);
}

.homepage-phone-preview__grid article {
  display: grid;
  justify-items: center;
  gap: 4px;
  min-width: 0;
  text-align: center;
}

.homepage-phone-preview__grid img,
.homepage-phone-preview__icon {
  width: 48px;
  aspect-ratio: 1;
  border-radius: 15px;
  object-fit: cover;
}

.homepage-phone-preview__grid strong {
  max-width: 100%;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.homepage-phone-preview__grid span {
  max-width: 100%;
  overflow: hidden;
  color: #887d89;
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.homepage-phone-preview__image-block {
  overflow: hidden;
  border-radius: 18px;
  background: #f2ecf4;
}

.homepage-phone-preview__image-block > img {
  aspect-ratio: 16 / 9;
}

.homepage-phone-preview__image-block > div:last-child {
  display: grid;
  gap: 4px;
  padding: 12px;
}

.homepage-phone-preview__image-block p {
  color: #766d79;
  font-size: 11px;
}

@media (max-width: 1180px) {
  .homepage-phone-preview > header small {
    display: none;
  }
}
</style>
