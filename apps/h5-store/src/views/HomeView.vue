<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';

import { BannerTargetType, type BannerView } from '@bake-mall/contracts';

import StorePage from '../components/layout/StorePage.vue';
import StoreSection from '../components/layout/StoreSection.vue';
import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import { CATALOG_COPY } from './catalog/config/copy.js';
import ProductCard from './catalog/components/ProductCard.vue';
import StoreTabbar from './catalog/components/StoreTabbar.vue';
import { useCatalog } from './catalog/hooks/useCatalog.js';

const route = useRoute();
const router = useRouter();
const catalog = useCatalog();

onMounted(async () => {
  try {
    await catalog.loadHome();
  } catch {
    showToast(catalog.lastError.value ?? '首页加载失败');
  }
});

function openBanner(banner: BannerView): void {
  if (banner.targetType === BannerTargetType.NONE) return;
  const path =
    banner.targetType === BannerTargetType.PRODUCT
      ? `/products/${banner.targetId}`
      : `/category/${banner.targetId}`;
  void router.push(path);
}
</script>

<template>
  <StorePage with-tabbar class="home-shell">
    <section
      v-if="catalog.banners.value.length"
      class="banner-reel"
      aria-label="推荐内容"
    >
      <button
        v-for="banner in catalog.banners.value"
        :key="banner.id"
        type="button"
        class="banner-reel__frame"
        :data-testid="`home-banner-${banner.id}`"
        @click="openBanner(banner)"
      >
        <img :src="banner.imageUrl" :alt="banner.title ?? '推荐烘焙'" />
        <span class="banner-reel__shade" aria-hidden="true" />
        <span class="banner-reel__title">
          {{ banner.title ?? '门店今日推荐' }}
        </span>
      </button>
    </section>

    <section class="hero">
      <p class="hero__eyebrow">{{ CATALOG_COPY.eyebrow }}</p>
      <h1>{{ CATALOG_COPY.heroTitle }}</h1>
      <p>{{ CATALOG_COPY.heroDescription }}</p>
    </section>

    <StoreSection title="单层分类" eyebrow="按心情挑选">
      <div class="category-strip">
        <button
          v-for="category in catalog.categories.value"
          :key="category.id"
          type="button"
          @click="router.push(`/category/${category.id}`)"
        >
          <span class="category-strip__mark">{{
            category.name.slice(0, 1)
          }}</span>
          {{ category.name }}
        </button>
      </div>
    </StoreSection>

    <StoreSection :title="CATALOG_COPY.popularTitle" eyebrow="店内常被带走">
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
      <div v-else class="product-grid">
        <ProductCard
          v-for="product in catalog.products.value"
          :key="product.id"
          :product="product"
          @open="router.push(`/products/${$event}`)"
        />
      </div>
    </StoreSection>

    <StoreSection :title="CATALOG_COPY.futureTitle" eyebrow="COMING SOON">
      <div class="future-card">
        <p>{{ CATALOG_COPY.futureDescription }}</p>
      </div>
    </StoreSection>

    <StoreTabbar :active-path="route.path" @navigate="router.push" />
  </StorePage>
</template>

<style scoped>
.home-shell {
  overflow-x: hidden;
}

.banner-reel {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 84%;
  gap: var(--mall-space-3);
  margin: 0 calc(var(--mall-page-gutter) * -1) var(--mall-space-4);
  padding: 0 var(--mall-page-gutter) var(--mall-space-1);
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: none;
}

.banner-reel::-webkit-scrollbar,
.category-strip::-webkit-scrollbar {
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

.category-strip {
  display: flex;
  gap: 10px;
  margin-right: calc(var(--mall-page-gutter) * -1);
  padding: 0 var(--mall-page-gutter) var(--mall-space-1) 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.category-strip button {
  display: flex;
  padding: 7px 13px 7px 7px;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--mall-border);
  border-radius: 999px;
  background: var(--mall-surface);
  color: var(--mall-text);
  cursor: pointer;
}

.category-strip__mark {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 50%;
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font-weight: 700;
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;
}

.future-card {
  padding: var(--mall-space-5);
  border: 1px dashed
    color-mix(in srgb, var(--mall-accent) 55%, var(--mall-border));
  border-radius: var(--mall-radius-feature);
  background: color-mix(in srgb, var(--mall-accent) 9%, var(--mall-surface));
}

.future-card p {
  margin: 0;
  color: var(--mall-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 380px) {
  .product-grid {
    gap: 10px;
  }
}
</style>
