<script setup lang="ts">
import type { CatalogProduct } from '../type/index.js';

const props = defineProps<{ product: CatalogProduct }>();
const emit = defineEmits<{ open: [id: string] }>();

const minimumPriceCents = () => {
  const prices = (props.product.skus ?? [])
    .filter((sku) => sku.isAvailable)
    .map((sku) => sku.priceCents);
  return prices.length ? Math.min(...prices) : null;
};
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
    <div class="product-card__body">
      <h3>{{ product.name }}</h3>
      <p>{{ product.summary ?? '门店现做，新鲜交付' }}</p>
      <strong v-if="minimumPriceCents() !== null">
        ¥{{ ((minimumPriceCents() ?? 0) / 100).toFixed(2) }} 起
      </strong>
      <strong v-else>到店了解</strong>
    </div>
  </article>
</template>

<style scoped>
.product-card { overflow: hidden; border-radius: 18px; background: #fff; box-shadow: 0 10px 28px rgba(90, 74, 52, .08); cursor: pointer; }
.product-card:focus-visible { outline: 2px solid var(--mall-leaf); outline-offset: 2px; }
.product-card__image-wrap { aspect-ratio: 4 / 3; background: #f4eadb; }
.product-card__image { width: 100%; height: 100%; object-fit: cover; }
.product-card__placeholder { height: 100%; display: grid; place-items: center; color: #9b795d; font-size: 13px; letter-spacing: .12em; }
.product-card__body { padding: 12px; }
h3 { margin: 0; font-size: 16px; color: var(--mall-ink); }
p { margin: 5px 0 10px; min-height: 34px; color: var(--mall-muted); font-size: 12px; line-height: 1.45; }
strong { color: #c87945; font-size: 15px; }
</style>
