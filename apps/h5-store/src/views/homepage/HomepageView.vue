<script setup lang="ts">
import type { BannerView, HomepageLink } from '@bake-mall/contracts';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import StorePage from '../../components/layout/StorePage.vue';
import StoreStatePanel from '../../components/feedback/StoreStatePanel.vue';
import BannerReel from '../catalog/components/BannerReel.vue';
import { bannerTargetPath } from '../catalog/config/navigation.js';
import HomepageCatalog from './components/HomepageCatalog.vue';
import HomepageRenderer from './components/HomepageRenderer.vue';
import { homepageLinkPath } from './config/navigation.js';
import { useHomepage } from './hooks/useHomepage.js';
import { useHomepageCatalog } from './hooks/useHomepageCatalog.js';

const router = useRouter();
const homepage = useHomepage();
const catalog = useHomepageCatalog();
const hasDecorationHero = computed(() => {
  const hero = homepage.data.value?.config.hero;
  return Boolean(
    hero?.enabled &&
    hero.slides.some(({ image }) => image.imageUrl.trim().length > 0),
  );
});

async function load(): Promise<void> {
  await Promise.allSettled([homepage.load(), catalog.load()]);
}

function navigate(link: HomepageLink): void {
  const path = homepageLinkPath(link);
  if (path) void router.push(path);
}

function openBanner(banner: BannerView): void {
  const path = bannerTargetPath(banner);
  if (path) void router.push(path);
}

onMounted(load);
</script>

<template>
  <StorePage full-bleed with-tabbar class="homepage-view">
    <HomepageRenderer
      :config="homepage.data.value?.config ?? null"
      @navigate="navigate"
    >
      <BannerReel
        v-if="!hasDecorationHero"
        :banners="catalog.banners.value"
        @open="openBanner"
      />
      <StoreStatePanel
        v-if="catalog.errors.value.banners"
        class="homepage-view__state"
        state="error"
        title="Banner 加载失败"
        :description="catalog.errors.value.banners"
      />
      <div class="homepage-view__catalog">
        <HomepageCatalog
          :categories="catalog.categories.value"
          :products="catalog.products.value"
          :loading="catalog.loading.value"
          :category-error="catalog.errors.value.categories"
          :product-error="catalog.errors.value.products"
          @open-category="router.push(`/category/${$event}`)"
          @open-product="router.push(`/products/${$event}`)"
        />
      </div>
      <StoreStatePanel
        v-if="homepage.loading.value && !homepage.loaded.value"
        class="homepage-view__state"
        state="loading"
        title="正在准备首页"
        description="新鲜内容马上就来。"
      />
      <StoreStatePanel
        v-else-if="homepage.error.value"
        class="homepage-view__state"
        state="error"
        title="首页加载失败"
        :description="homepage.error.value"
      >
        <template #action>
          <button type="button" class="homepage-view__action" @click="load">
            重新加载
          </button>
        </template>
      </StoreStatePanel>
      <StoreStatePanel
        v-else-if="!homepage.data.value"
        class="homepage-view__state"
        state="empty"
        title="首页正在准备中"
        description="可以先去商品页挑选今天的烘焙。"
      >
        <template #action>
          <button
            type="button"
            class="homepage-view__action"
            @click="router.push('/products')"
          >
            去商品页
          </button>
        </template>
      </StoreStatePanel>
    </HomepageRenderer>
  </StorePage>
</template>

<style scoped>
.homepage-view {
  overflow-x: hidden;
}

.homepage-view__state {
  margin: var(--mall-space-8) var(--mall-page-gutter);
}

.homepage-view__catalog {
  padding: 0 var(--mall-page-gutter) var(--mall-space-8);
}

.homepage-view__action {
  min-height: 44px;
  padding: 0 var(--mall-space-5);
  border: 0;
  border-radius: var(--mall-radius-card);
  background: var(--mall-primary);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}
</style>
