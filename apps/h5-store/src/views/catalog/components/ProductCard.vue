<script setup lang="ts">
import { computed } from 'vue';

import type { CatalogProduct } from '../type/index.js';

const props = defineProps<{ product: CatalogProduct }>();
const emit = defineEmits<{ open: [id: string] }>();

function minimumAvailablePriceCents(product: CatalogProduct): number | null {
  const prices = product.skus
    .filter(({ isAvailable, stock }) => isAvailable && stock > 0)
    .map(({ priceCents }) => priceCents);
  return prices.length > 0 ? Math.min(...prices) : null;
}

const minimumPriceCents = computed(() =>
  minimumAvailablePriceCents(props.product),
);
</script>

<template>
  <article
    class="product-card"
    :data-testid="`product-card-${product.id}`"
    tabindex="0"
    role="button"
    @click="emit('open', product.id)"
    @keydown.enter="emit('open', product.id)"
  >
    <div class="product-card__image-wrap">
      <img
        v-if="product.coverImageUrl"
        :src="product.coverImageUrl"
        :alt="product.name"
        class="product-card__image"
      />
      <div v-else class="product-card__placeholder">今日现做</div>
    </div>
    <div class="product-card__body" data-layout="stable">
      <h3>{{ product.name }}</h3>
      <p>{{ product.summary ?? '门店现做，新鲜交付' }}</p>
      <strong v-if="minimumPriceCents !== null">
        ¥{{ (minimumPriceCents / 100).toFixed(2) }} 起
      </strong>
      <strong v-else>到店了解</strong>
    </div>
  </article>
</template>

<style scoped>
.product-card {
  display: flex;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
  cursor: pointer;
}

.product-card:focus-visible {
  outline: 2px solid var(--mall-primary);
  outline-offset: 2px;
}

.product-card__image-wrap {
  aspect-ratio: 1 / 0.78;
  flex: 0 0 auto;
  overflow: hidden;
  background: var(--mall-surface-soft);
}

.product-card__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 180ms ease;
}

.product-card:hover .product-card__image {
  transform: scale(1.02);
}

.product-card__placeholder {
  display: grid;
  height: 100%;
  place-items: center;
  color: var(--mall-primary-strong);
  font-size: 12px;
  letter-spacing: 0.1em;
}

.product-card__body {
  display: flex;
  min-height: 118px;
  padding: var(--mall-space-3);
  flex: 1;
  flex-direction: column;
}

.product-card h3 {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--mall-text);
  font-size: 15px;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.product-card p {
  display: -webkit-box;
  overflow: hidden;
  margin: var(--mall-space-1) 0 var(--mall-space-2);
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.product-card strong {
  margin-top: auto;
  color: var(--mall-accent);
  font-size: 15px;
  line-height: 1.4;
}

@media (prefers-reduced-motion: reduce) {
  .product-card__image {
    transition: none;
  }
}
</style>
