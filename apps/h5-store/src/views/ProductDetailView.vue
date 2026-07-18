<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ActionSheet, showSuccessToast, showToast } from 'vant';

import { customerApi } from '../api/customer.js';
import { useAuthStore } from '../stores/auth.js';
import SkuPicker from '../components/SkuPicker.vue';
import StoreTabbar from './catalog/components/StoreTabbar.vue';
import { useCatalog } from './catalog/hooks/useCatalog.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
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
    await customerApi.upsertCartItem(payload);
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
  <main class="product-detail">
    <button type="button" class="back" @click="router.back()">‹</button>
    <template v-if="catalog.product.value">
      <section class="gallery">
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
      <section class="detail-html">
        <h2>这份烘焙的细节</h2>
        <!-- 服务端持久化前已通过 HtmlSanitizerService 白名单清洗。 -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-html="catalog.product.value.detailHtml" />
      </section>
    </template>
    <p v-else class="loading">正在准备商品详情…</p>

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
        <p v-if="submitting">正在加入购物车…</p>
      </div>
    </ActionSheet>
    <StoreTabbar />
  </main>
</template>

<style scoped>
.product-detail {
  width: min(100%, 560px);
  min-height: 100%;
  margin: 0 auto;
  padding-bottom: 92px;
  background: #fffaf3;
}
.back {
  position: fixed;
  z-index: 5;
  top: 14px;
  left: max(14px, calc(50% - 266px));
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  color: #4e7055;
  font-size: 28px;
  box-shadow: 0 5px 18px rgba(60, 53, 44, 0.12);
}
.gallery {
  height: 360px;
  background: #eadfce;
}
.gallery img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.gallery__placeholder {
  height: 100%;
  display: grid;
  place-items: center;
  color: #95795d;
  letter-spacing: 0.12em;
}
.summary {
  position: relative;
  margin: -42px 14px 0;
  padding: 22px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 16px 36px rgba(78, 64, 48, 0.12);
}
.summary small {
  color: #6f9775;
  letter-spacing: 0.18em;
}
h1 {
  margin: 7px 0;
  font:
    700 28px/1.2 Georgia,
    'Songti SC',
    serif;
}
.summary p {
  color: var(--mall-muted);
  line-height: 1.6;
}
.summary button {
  width: 100%;
  height: 48px;
  border: 0;
  border-radius: 16px;
  background: #739c78;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}
.detail-html {
  padding: 28px 20px;
  color: #575149;
  line-height: 1.75;
}
.detail-html h2 {
  font:
    700 20px/1.3 Georgia,
    'Songti SC',
    serif;
}
.sku-sheet-body {
  padding: 18px 20px calc(26px + env(safe-area-inset-bottom));
}
.loading {
  padding: 120px 20px;
  text-align: center;
  color: var(--mall-muted);
}
</style>
