<script setup lang="ts">
import StoreSection from '../../../components/layout/StoreSection.vue';
import StoreStatePanel from '../../../components/feedback/StoreStatePanel.vue';
import ProductCard from '../../catalog/components/ProductCard.vue';
import { CATALOG_COPY } from '../../catalog/config/copy.js';
import type {
  CatalogCategory,
  CatalogProduct,
} from '../../catalog/type/index.js';

defineProps<{
  readonly categories: readonly CatalogCategory[];
  readonly products: readonly CatalogProduct[];
  readonly loading: boolean;
  readonly categoryError: string | null;
  readonly productError: string | null;
}>();

const emit = defineEmits<{
  openCategory: [id: string];
  openProduct: [id: string];
}>();
</script>

<template>
  <div class="homepage-catalog">
    <StoreSection title="单层分类" eyebrow="按心情挑选">
      <StoreStatePanel
        v-if="categoryError"
        state="error"
        title="分类加载失败"
        :description="categoryError"
      />
      <div v-else-if="categories.length" class="homepage-catalog__categories">
        <button
          v-for="category in categories"
          :key="category.id"
          type="button"
          @click="emit('openCategory', category.id)"
        >
          <span class="homepage-catalog__category-mark">{{
            category.name.slice(0, 1)
          }}</span>
          {{ category.name }}
        </button>
      </div>
    </StoreSection>

    <StoreSection :title="CATALOG_COPY.popularTitle" eyebrow="店内常被带走">
      <StoreStatePanel
        v-if="loading && !products.length"
        state="loading"
        title="正在摆好今日陈列"
        description="新鲜烘焙很快就来。"
      />
      <StoreStatePanel
        v-else-if="productError"
        state="error"
        title="商品内容加载失败"
        :description="productError"
      />
      <StoreStatePanel
        v-else-if="!products.length"
        state="empty"
        title="今天的烘焙还在准备中"
        description="晚一点再来看看吧。"
      />
      <div v-else class="product-grid" data-testid="homepage-product-grid">
        <ProductCard
          v-for="product in products"
          :key="product.id"
          :product="product"
          @open="emit('openProduct', $event)"
        />
      </div>
    </StoreSection>

    <StoreSection :title="CATALOG_COPY.futureTitle" eyebrow="COMING SOON">
      <div class="homepage-catalog__future">
        <p>{{ CATALOG_COPY.futureDescription }}</p>
      </div>
    </StoreSection>
  </div>
</template>

<style scoped>
.homepage-catalog {
  display: grid;
  gap: var(--mall-space-8);
}

.homepage-catalog__categories {
  display: flex;
  gap: 10px;
  margin-right: calc(var(--mall-page-gutter) * -1);
  padding: 0 var(--mall-page-gutter) var(--mall-space-1) 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.homepage-catalog__categories::-webkit-scrollbar {
  display: none;
}

.homepage-catalog__categories button {
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

.homepage-catalog__category-mark {
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
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.homepage-catalog__future {
  padding: var(--mall-space-5);
  border: 1px dashed
    color-mix(in srgb, var(--mall-accent) 55%, var(--mall-border));
  border-radius: var(--mall-radius-feature);
  background: color-mix(in srgb, var(--mall-accent) 9%, var(--mall-surface));
}

.homepage-catalog__future p {
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
