<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search, showToast } from 'vant';

import StorePage from '../components/layout/StorePage.vue';
import StorePageHeader from '../components/layout/StorePageHeader.vue';
import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import ProductCard from './catalog/components/ProductCard.vue';
import StoreTabbar from './catalog/components/StoreTabbar.vue';
import { useCatalog } from './catalog/hooks/useCatalog.js';

const route = useRoute();
const router = useRouter();
const catalog = useCatalog();
const query = ref(typeof route.query.q === 'string' ? route.query.q : '');

async function refresh(): Promise<void> {
  try {
    await catalog.loadProducts({
      categoryId: String(route.params.id),
      q: query.value,
    });
  } catch {
    showToast(catalog.lastError.value ?? '商品加载失败');
  }
}

onMounted(refresh);
watch(() => route.params.id, refresh);

function submitSearch(): void {
  void router.replace({
    query: query.value.trim() ? { q: query.value.trim() } : {},
  });
  void refresh();
}
</script>

<template>
  <StorePage with-tabbar class="category-view">
    <StorePageHeader
      back
      eyebrow="在这个分类里"
      title="挑选喜欢的烘焙"
      description="按名称快速找到今天想吃的口味。"
      @back="router.back()"
    />

    <section class="category-tools" aria-label="商品筛选工具">
      <Search
        v-model="query"
        shape="round"
        placeholder="搜索商品名称"
        data-testid="catalog-search"
        @search="submitSearch"
        @clear="submitSearch"
      />
      <p class="category-tools__summary" aria-live="polite">
        <template v-if="catalog.loading.value">正在查找合适的烘焙…</template>
        <template v-else-if="query.trim()">
          “{{ query.trim() }}”共找到 {{ catalog.products.value.length }} 款
        </template>
        <template v-else
          >共找到 {{ catalog.products.value.length }} 款商品</template
        >
      </p>
    </section>

    <StoreStatePanel
      v-if="catalog.loading.value"
      state="loading"
      title="正在查找"
      description="马上为你呈现这个分类的商品。"
    />
    <StoreStatePanel
      v-else-if="!catalog.products.value.length"
      state="empty"
      title="没有找到对应商品"
      description="换个关键词试试。"
    />
    <section v-else class="product-grid" aria-label="商品列表">
      <ProductCard
        v-for="product in catalog.products.value"
        :key="product.id"
        :product="product"
        @open="router.push(`/products/${$event}`)"
      />
    </section>

    <StoreTabbar :active-path="route.path" @navigate="router.push" />
  </StorePage>
</template>

<style scoped>
.category-view {
  overflow-x: hidden;
}

.category-tools {
  margin-bottom: var(--mall-space-5);
  padding: var(--mall-space-2) var(--mall-space-4) var(--mall-space-3);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-feature);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}

:deep(.van-search) {
  padding: var(--mall-space-2) 0;
  background: transparent;
}

:deep(.van-search__content) {
  border: 1px solid transparent;
  background: var(--mall-surface-soft);
}

:deep(.van-search__content:focus-within) {
  border-color: var(--mall-primary);
}

.category-tools__summary {
  margin: var(--mall-space-1) 0 0;
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;
}

@media (max-width: 380px) {
  .product-grid {
    gap: 10px;
  }
}
</style>
