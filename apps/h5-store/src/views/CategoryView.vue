<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search, showToast } from 'vant';

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
  void router.replace({ query: query.value.trim() ? { q: query.value.trim() } : {} });
  void refresh();
}
</script>

<template>
  <main class="category-view">
    <header>
      <button type="button" @click="router.back()">‹</button>
      <div><small>在这个分类里</small><h1>挑选喜欢的烘焙</h1></div>
    </header>
    <Search
      v-model="query"
      shape="round"
      placeholder="搜索商品名称"
      data-testid="catalog-search"
      @search="submitSearch"
      @clear="submitSearch"
    />
    <p v-if="catalog.loading.value" class="state-copy">正在查找…</p>
    <p v-else-if="!catalog.products.value.length" class="state-copy">没有找到对应商品，换个关键词试试。</p>
    <section v-else class="product-grid">
      <ProductCard
        v-for="product in catalog.products.value"
        :key="product.id"
        :product="product"
        @open="router.push(`/products/${$event}`)"
      />
    </section>
    <StoreTabbar />
  </main>
</template>

<style scoped>
.category-view { width: min(100%, 560px); min-height: 100%; margin: 0 auto; padding: 18px 16px 96px; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
header button { width: 38px; height: 38px; border: 0; border-radius: 50%; background: #e1eddd; color: #52795a; font-size: 27px; }
small { color: #78917a; letter-spacing: .12em; }
h1 { margin: 2px 0 0; font: 700 23px/1.2 Georgia, 'Songti SC', serif; }
:deep(.van-search) { padding: 8px 0 18px; background: transparent; }
.product-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.state-copy { padding: 48px 12px; text-align: center; color: var(--mall-muted); }
</style>
