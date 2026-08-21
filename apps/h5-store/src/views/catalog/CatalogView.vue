<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';

import type { BannerView, HomepageLink } from '@bake-mall/contracts';

import StoreStatePanel from '../../components/feedback/StoreStatePanel.vue';
import StorePage from '../../components/layout/StorePage.vue';
import StoreSection from '../../components/layout/StoreSection.vue';
import HomepageCarousel from '../homepage/components/HomepageCarousel.vue';
import { homepageLinkPath } from '../homepage/config/navigation.js';
import { useHomepage } from '../homepage/hooks/useHomepage.js';
import BannerReel from './components/BannerReel.vue';
import CatalogCategoryWorkspace from './components/CatalogCategoryWorkspace.vue';
import { CATALOG_COPY } from './config/copy.js';
import { bannerTargetPath } from './config/navigation.js';
import { useCatalog } from './hooks/useCatalog.js';

const router = useRouter();
const catalog = useCatalog();
const homepage = useHomepage();

onMounted(async () => {
  const [catalogResult] = await Promise.allSettled([
    catalog.loadCatalogLanding(),
    homepage.load(),
  ]);
  if (catalogResult.status === 'rejected') {
    showToast(catalog.lastError.value ?? '商品页加载失败');
  }
});

function openBanner(banner: BannerView): void {
  const path = bannerTargetPath(banner);
  if (path) void router.push(path);
}

function openHomepageLink(link: HomepageLink): void {
  const path = homepageLinkPath(link);
  if (path) void router.push(path);
}
</script>

<template>
  <StorePage with-tabbar class="catalog-page">
    <HomepageCarousel
      v-if="homepage.data.value?.config.hero"
      compact
      class="catalog-page__carousel"
      :section="homepage.data.value.config.hero"
      @navigate="openHomepageLink"
    />
    <BannerReel
      v-else
      class="catalog-page__banners"
      :banners="catalog.banners.value"
      @open="openBanner"
    />

    <section class="hero">
      <p class="hero__eyebrow">{{ CATALOG_COPY.eyebrow }}</p>
      <h1>{{ CATALOG_COPY.heroTitle }}</h1>
      <p>{{ CATALOG_COPY.heroDescription }}</p>
    </section>

    <StoreSection
      :title="CATALOG_COPY.popularTitle"
      eyebrow="按分类挑选"
      class="catalog-page__products"
    >
      <StoreStatePanel
        v-if="catalog.loading.value && !catalog.products.value.length"
        state="loading"
        title="正在摆好今日陈列"
        description="新鲜烘焙很快就来。"
      />
      <StoreStatePanel
        v-else-if="!catalog.products.value.length"
        state="empty"
        title="今天的烘焙还在准备中"
        description="晚一点再来看看吧。"
      />
      <CatalogCategoryWorkspace
        v-else
        :categories="catalog.categories.value"
        :products="catalog.products.value"
        @open-product="router.push(`/products/${$event}`)"
      />
    </StoreSection>

    <StoreSection :title="CATALOG_COPY.futureTitle" eyebrow="COMING SOON">
      <div class="future-card">
        <p>{{ CATALOG_COPY.futureDescription }}</p>
      </div>
    </StoreSection>
  </StorePage>
</template>

<style scoped>
.catalog-page {
  overflow-x: hidden;
}

.catalog-page__carousel,
.catalog-page__banners {
  width: 100%;
  margin: 0 0 var(--mall-space-4);
}

.catalog-page__carousel {
  overflow: hidden;
  border-radius: var(--mall-radius-feature);
}

.catalog-page__carousel :deep(.homepage-carousel__copy) {
  bottom: var(--mall-space-5);
}

.catalog-page__carousel :deep(.homepage-carousel__copy strong) {
  font-size: clamp(22px, 7vw, 32px);
}

.catalog-page__carousel :deep(.van-swipe__indicators) {
  bottom: var(--mall-space-3);
}

.hero {
  position: relative;
  margin-bottom: var(--mall-space-8);
  padding: var(--mall-space-5);
  overflow: hidden;
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-feature);
  background: linear-gradient(135deg, var(--mall-surface-soft), #f8eee4);
}

.hero::after {
  position: absolute;
  right: -8px;
  bottom: -11px;
  color: rgb(255 255 255 / 62%);
  content: 'BAKE';
  font-size: 42px;
  font-weight: 800;
  letter-spacing: -0.08em;
  line-height: 1;
}

.hero__eyebrow {
  margin: 0 0 var(--mall-space-1);
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.hero h1 {
  max-width: 280px;
  margin: 0;
  color: var(--mall-text);
  font-size: 24px;
  line-height: 1.3;
}

.hero > p:last-of-type {
  max-width: 300px;
  margin: var(--mall-space-2) 0 0;
  color: var(--mall-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.catalog-page__products {
  margin-right: calc(var(--mall-page-gutter) * -1);
  margin-left: calc(var(--mall-page-gutter) * -1);
}

.catalog-page__products :deep(.store-section__header) {
  padding-right: var(--mall-page-gutter);
  padding-left: var(--mall-page-gutter);
}

.future-card {
  padding: var(--mall-space-5);
  border: 1px dashed var(--mall-accent);
  border-radius: var(--mall-radius-feature);
  background: var(--mall-surface-soft);
}

.future-card p {
  margin: 0;
  color: var(--mall-text-muted);
  font-size: 13px;
  line-height: 1.6;
}
</style>
