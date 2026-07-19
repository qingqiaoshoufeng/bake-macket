<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ActionSheet, showSuccessToast, showToast } from 'vant';

import StorePage from '../components/layout/StorePage.vue';
import StorePageHeader from '../components/layout/StorePageHeader.vue';
import StoreSection from '../components/layout/StoreSection.vue';
import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import SkuPicker from '../components/SkuPicker.vue';
import { useAuthStore } from '../stores/auth.js';
import { useCart } from './cart/hooks/useCart.js';
import StoreTabbar from './catalog/components/StoreTabbar.vue';
import { useCatalog } from './catalog/hooks/useCatalog.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const cart = useCart();
const catalog = useCatalog();
const skuSheetOpen = ref(false);
const submitting = ref(false);

const images = computed(() => {
  const detail = catalog.product.value;
  if (!detail) return [];
  const carousel = detail.images.map((image) => image.url);
  return carousel.length
    ? carousel
    : detail.coverImageUrl
      ? [detail.coverImageUrl]
      : [];
});

onMounted(async () => {
  try {
    await catalog.loadProduct(String(route.params.id));
  } catch {
    showToast(catalog.lastError.value ?? '商品详情加载失败');
  }
});

async function addToCart(payload: {
  skuId: string;
  quantity: number;
}): Promise<void> {
  if (!auth.isAuthenticated) {
    await router.push(`/login?redirect=${encodeURIComponent(route.fullPath)}`);
    return;
  }
  submitting.value = true;
  try {
    await cart.methods.add(payload);
    skuSheetOpen.value = false;
    showSuccessToast('已加入购物车');
  } catch (error) {
    showToast(error instanceof Error ? error.message : '加入购物车失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <StorePage with-tabbar compact class="product-detail">
    <StorePageHeader back title="商品详情" @back="router.back()" />

    <template v-if="catalog.product.value">
      <div class="product-detail__canvas">
        <section class="gallery" aria-label="商品图片">
          <img
            v-if="images[0]"
            :src="images[0]"
            :alt="catalog.product.value.name"
          />
          <div v-else class="gallery__placeholder">门店现做 · 图片准备中</div>
        </section>

        <section class="summary">
          <small>BAKED TODAY</small>
          <h1>{{ catalog.product.value.name }}</h1>
          <p>
            {{ catalog.product.value.summary ?? '今日制作，按约定时间交付。' }}
          </p>
          <button
            type="button"
            data-testid="choose-sku"
            @click="skuSheetOpen = true"
          >
            选择规格与数量
          </button>
        </section>

        <StoreSection title="这份烘焙的细节" eyebrow="PRODUCT NOTES">
          <div class="detail-html">
            <!-- 服务端持久化前已通过 HtmlSanitizerService 白名单清洗。 -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-html="catalog.product.value.detailHtml" />
          </div>
        </StoreSection>
      </div>
    </template>

    <StoreStatePanel
      v-else
      state="loading"
      title="正在准备商品详情"
      description="新鲜出炉的信息马上就来。"
    />

    <ActionSheet
      v-model:show="skuSheetOpen"
      title="选择规格"
      data-testid="sku-sheet"
    >
      <div class="sku-sheet-body">
        <SkuPicker
          v-if="catalog.product.value"
          :skus="catalog.product.value.skus"
          @add="addToCart"
        />
        <p v-if="submitting" class="sku-sheet-body__status">正在加入购物车…</p>
      </div>
    </ActionSheet>
    <StoreTabbar :active-path="route.path" @navigate="router.push" />
  </StorePage>
</template>

<style scoped>
.product-detail {
  overflow-x: hidden;
}

.product-detail__canvas {
  padding-bottom: var(--mall-space-2);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-feature);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}

.gallery {
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--mall-radius-feature) var(--mall-radius-feature) 0 0;
  background: var(--mall-surface-soft);
}

.gallery img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gallery__placeholder {
  display: grid;
  height: 100%;
  place-items: center;
  color: var(--mall-text-muted);
  font-size: 13px;
  letter-spacing: 0.1em;
}

.summary {
  position: relative;
  margin: -34px var(--mall-space-3) var(--mall-space-8);
  padding: var(--mall-space-5);
  border: 1px solid color-mix(in srgb, var(--mall-border) 78%, transparent);
  border-radius: var(--mall-radius-feature);
  background: rgb(255 255 255 / 96%);
  box-shadow: var(--mall-shadow-floating);
}

.summary small {
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.summary h1 {
  margin: var(--mall-space-1) 0 0;
  color: var(--mall-text);
  font-size: 27px;
  line-height: 1.25;
}

.summary p {
  margin: var(--mall-space-2) 0 var(--mall-space-4);
  color: var(--mall-text-muted);
  font-size: 14px;
  line-height: 1.65;
}

.summary button {
  width: 100%;
  min-height: 46px;
  padding: 0 var(--mall-space-4);
  border: 0;
  border-radius: var(--mall-radius-card);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.product-detail__canvas :deep(.store-section) {
  padding: 0 var(--mall-space-5) var(--mall-space-5);
}

.detail-html {
  color: var(--mall-text-muted);
  font-size: 14px;
  line-height: 1.75;
}

.detail-html :deep(> div > :first-child) {
  margin-top: 0;
}

.detail-html :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--mall-radius-card);
}

.sku-sheet-body {
  padding: var(--mall-space-4) var(--mall-space-5)
    calc(var(--mall-space-6) + env(safe-area-inset-bottom));
}

.sku-sheet-body__status {
  margin: var(--mall-space-3) 0 0;
  color: var(--mall-text-muted);
  font-size: 13px;
  text-align: center;
}
</style>
