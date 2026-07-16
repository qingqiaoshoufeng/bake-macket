<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';

import { CATALOG_COPY } from './catalog/config/copy.js';
import ProductCard from './catalog/components/ProductCard.vue';
import StoreTabbar from './catalog/components/StoreTabbar.vue';
import { useCatalog } from './catalog/hooks/useCatalog.js';

const router = useRouter();
const catalog = useCatalog();

onMounted(async () => {
  try {
    await catalog.loadHome();
  } catch {
    showToast(catalog.lastError.value ?? '首页加载失败');
  }
});

function openBanner(targetType: string, targetId?: string): void {
  if (!targetId) return;
  const path = targetType === 'PRODUCT'
    ? `/products/${targetId}`
    : `/category/${targetId}`;
  void router.push(path);
}
</script>

<template>
  <main class="home-shell">
    <section class="hero">
      <p class="hero__eyebrow">{{ CATALOG_COPY.eyebrow }}</p>
      <h1>{{ CATALOG_COPY.heroTitle }}</h1>
      <p>{{ CATALOG_COPY.heroDescription }}</p>
    </section>

    <section v-if="catalog.banners.value.length" class="banner-reel" aria-label="推荐内容">
      <button
        v-for="banner in catalog.banners.value"
        :key="banner.id"
        type="button"
        class="banner-reel__frame"
        @click="openBanner(banner.targetType, banner.targetId)"
      >
        <img :src="banner.imageUrl" :alt="banner.title ?? '推荐烘焙'" />
        <span>{{ banner.title ?? '门店今日推荐' }}</span>
      </button>
    </section>

    <section class="section-block">
      <header class="section-head">
        <div><small>按心情挑选</small><h2>单层分类</h2></div>
      </header>
      <div class="category-strip">
        <button
          v-for="category in catalog.categories.value"
          :key="category.id"
          type="button"
          @click="router.push(`/category/${category.id}`)"
        >
          <span class="category-strip__mark">{{ category.name.slice(0, 1) }}</span>
          {{ category.name }}
        </button>
      </div>
    </section>

    <section class="section-block">
      <header class="section-head">
        <div><small>店内常被带走</small><h2>{{ CATALOG_COPY.popularTitle }}</h2></div>
      </header>
      <p v-if="catalog.loading.value && !catalog.products.value.length" class="state-copy">正在摆好今日陈列…</p>
      <p v-else-if="!catalog.products.value.length" class="state-copy">今天的烘焙还在准备中。</p>
      <div v-else class="product-grid">
        <ProductCard
          v-for="product in catalog.products.value"
          :key="product.id"
          :product="product"
          @open="router.push(`/products/${$event}`)"
        />
      </div>
    </section>

    <section class="future-card">
      <span>COMING SOON</span>
      <h2>{{ CATALOG_COPY.futureTitle }}</h2>
      <p>{{ CATALOG_COPY.futureDescription }}</p>
    </section>
    <StoreTabbar />
  </main>
</template>

<style scoped>
.home-shell { width: min(100%, 560px); min-height: 100%; margin: 0 auto; padding: 18px 16px 96px; overflow: hidden; }
.hero { position: relative; padding: 28px 22px 30px; border-radius: 28px 28px 70px 28px; background: linear-gradient(140deg, #dcebd8, #f7ddbd); box-shadow: 0 18px 42px rgba(91, 105, 70, .13); }
.hero::after { content: 'BAKE'; position: absolute; right: -4px; bottom: -13px; color: rgba(255,255,255,.42); font: 800 52px/1 Georgia, serif; letter-spacing: -.08em; }
.hero__eyebrow, .section-head small { margin: 0 0 8px; color: #5c8465; font-size: 11px; font-weight: 700; letter-spacing: .18em; }
.hero h1 { max-width: 280px; margin: 0 0 10px; font: 700 29px/1.2 Georgia, 'Songti SC', serif; color: #334337; }
.hero > p:last-of-type { max-width: 270px; margin: 0; color: #6e746c; font-size: 13px; line-height: 1.65; }
.banner-reel { display: grid; grid-auto-flow: column; grid-auto-columns: 82%; gap: 12px; margin: 18px -16px 0; padding: 0 16px 4px; overflow-x: auto; scrollbar-width: none; }
.banner-reel__frame { position: relative; height: 142px; overflow: hidden; border: 0; border-radius: 22px; padding: 0; background: #e7d9c7; box-shadow: 0 12px 26px rgba(79,65,49,.11); }
.banner-reel img { width: 100%; height: 100%; object-fit: cover; }
.banner-reel span { position: absolute; left: 14px; bottom: 12px; padding: 7px 10px; border-radius: 999px; background: rgba(255,255,255,.88); color: #465c49; font-size: 12px; }
.section-block { margin-top: 28px; }
.section-head { display: flex; justify-content: space-between; align-items: end; margin-bottom: 12px; }
.section-head small { display: block; margin-bottom: 4px; }
.section-head h2, .future-card h2 { margin: 0; font: 700 22px/1.25 Georgia, 'Songti SC', serif; }
.category-strip { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; }
.category-strip button { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; border: 1px solid rgba(125,167,125,.2); border-radius: 999px; padding: 7px 13px 7px 7px; background: #fff; color: var(--mall-ink); }
.category-strip__mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #e1eddd; color: #5f8967; font-weight: 700; }
.product-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.state-copy { padding: 28px 0; text-align: center; color: var(--mall-muted); }
.future-card { margin-top: 30px; padding: 22px; border: 1px dashed #d8b68f; border-radius: 26px; background: #fff6e8; }
.future-card span { color: #c6804d; font-size: 10px; letter-spacing: .2em; }
.future-card p { margin: 7px 0 0; color: var(--mall-muted); font-size: 13px; }
</style>
