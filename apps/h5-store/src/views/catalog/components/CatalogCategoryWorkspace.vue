<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue';

import type { CatalogCategory, CatalogProduct } from '../type/index.js';

const props = defineProps<{
  readonly categories: readonly CatalogCategory[];
  readonly products: readonly CatalogProduct[];
}>();

const emit = defineEmits<{
  openProduct: [productId: string];
}>();

const activeCategoryId = ref<string>('all');
const categoryRail = ref<HTMLElement | null>(null);
const productPane = ref<HTMLElement | null>(null);
const categoryButtons = new Map<string, HTMLElement>();
const categorySections = new Map<string, HTMLElement>();
let syncFrame: number | null = null;

const groupedCategories = computed(() =>
  props.categories.map((category) => ({
    ...category,
    products: props.products.filter(
      ({ categoryId }) => categoryId === category.id,
    ),
  })),
);

const activeCategory = computed(() =>
  props.categories.find(({ id }) => id === activeCategoryId.value),
);

const activeCategoryProductCount = computed(() =>
  activeCategoryId.value === 'all'
    ? props.products.length
    : categoryCount(activeCategoryId.value),
);

function categoryCount(categoryId: string): number {
  return props.products.filter(({ categoryId: value }) => value === categoryId)
    .length;
}

function minimumPrice(product: CatalogProduct): string {
  const available = product.skus
    .filter(({ isAvailable, stock }) => isAvailable && stock > 0)
    .map(({ priceCents }) => priceCents);
  return available.length > 0
    ? `¥${(Math.min(...available) / 100).toFixed(0)} 起`
    : '到店咨询';
}

function setCategoryButton(categoryId: string, element: Element | null): void {
  if (element instanceof HTMLElement) categoryButtons.set(categoryId, element);
  else categoryButtons.delete(categoryId);
}

function setCategorySection(categoryId: string, element: Element | null): void {
  if (element instanceof HTMLElement) categorySections.set(categoryId, element);
  else categorySections.delete(categoryId);
}

function keepActiveCategoryVisible(categoryId: string): void {
  const rail = categoryRail.value;
  const button = categoryButtons.get(categoryId);
  if (!rail || !button) return;
  const railRect = rail.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  if (buttonRect.top >= railRect.top && buttonRect.bottom <= railRect.bottom) {
    return;
  }
  const targetTop = Math.min(
    Math.max(0, button.offsetTop),
    Math.max(0, rail.scrollHeight - rail.clientHeight),
  );
  rail.scrollTop = targetTop;
}

function changeCategory(categoryId: string): void {
  const pane = productPane.value;
  const section = categorySections.get(categoryId);
  activeCategoryId.value = categoryId;
  if (pane) {
    pane.scrollTop =
      categoryId === 'all'
        ? 0
        : section?.offsetTop ?? pane.scrollHeight;
  }
  keepActiveCategoryVisible(categoryId);
}

function syncCategoryFromProductScroll(): void {
  syncFrame = null;
  const pane = productPane.value;
  if (!pane) return;
  const threshold = pane.scrollTop + 8;
  const reachedBottom =
    pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
  const entered = groupedCategories.value
    .filter(
      ({ id }) =>
        (categorySections.get(id)?.offsetTop ?? Infinity) <= threshold,
    )
    .map(({ id }) => id)
    .pop();
  const nextCategoryId = reachedBottom
    ? (groupedCategories.value[groupedCategories.value.length - 1]?.id ??
      'all')
    : (entered ?? 'all');
  if (nextCategoryId === activeCategoryId.value) return;
  activeCategoryId.value = nextCategoryId;
  keepActiveCategoryVisible(nextCategoryId);
}

function handleProductScroll(): void {
  if (syncFrame !== null) window.cancelAnimationFrame(syncFrame);
  syncFrame = window.requestAnimationFrame(syncCategoryFromProductScroll);
}

watch(
  () => [props.categories.length, props.products.length] as const,
  async () => {
    await nextTick();
    activeCategoryId.value = 'all';
    if (productPane.value) productPane.value.scrollTop = 0;
  },
);

onBeforeUnmount(() => {
  if (syncFrame !== null) window.cancelAnimationFrame(syncFrame);
});
</script>

<template>
  <section class="catalog-category-workspace" aria-label="商品分类与商品列表">
    <nav ref="categoryRail" class="category-rail" aria-label="商品分类">
      <button
        :ref="(element) => setCategoryButton('all', element as Element | null)"
        type="button"
        data-category-button="all"
        :class="{ 'is-active': activeCategoryId === 'all' }"
        @click="changeCategory('all')"
      >
        <strong>全部</strong>
        <small>{{ products.length }}</small>
      </button>
      <button
        v-for="category in categories"
        :key="category.id"
        :ref="
          (element) =>
            setCategoryButton(category.id, element as Element | null)
        "
        type="button"
        :data-category-button="category.id"
        :class="{ 'is-active': activeCategoryId === category.id }"
        @click="changeCategory(category.id)"
      >
        <strong>{{ category.name }}</strong>
        <small>{{ categoryCount(category.id) }}</small>
      </button>
    </nav>

    <main
      ref="productPane"
      class="product-pane"
      data-testid="catalog-product-pane"
      @scroll.passive="handleProductScroll"
    >
      <header class="product-pane__title">
        <div>
          <small>TODAY MENU</small>
          <h1>{{ activeCategory?.name ?? '全部烘焙' }}</h1>
        </div>
        <span>{{ activeCategoryProductCount }} 款</span>
      </header>

      <div v-if="groupedCategories.length" class="product-groups">
        <section
          v-for="category in groupedCategories"
          :key="category.id"
          :ref="
            (element) =>
              setCategorySection(category.id, element as Element | null)
          "
          class="product-group"
          data-category-group
          :data-category-id="category.id"
        >
          <h2>{{ category.name }}</h2>
          <p v-if="!category.products.length" class="category-empty">
            该分类暂无商品
          </p>
          <article
            v-for="product in category.products"
            :key="product.id"
            class="product-row"
            :data-testid="`catalog-product-row-${product.id}`"
            tabindex="0"
            role="button"
            @click="emit('openProduct', product.id)"
            @keydown.enter="emit('openProduct', product.id)"
          >
            <div class="product-row__image">
              <img
                v-if="product.coverImageUrl"
                :src="product.coverImageUrl"
                :alt="product.name"
              />
              <span v-else>今日现做</span>
            </div>
            <div class="product-row__content">
              <h3>{{ product.name }}</h3>
              <p>{{ product.summary ?? '门店现做，新鲜交付' }}</p>
              <footer>
                <strong>{{ minimumPrice(product) }}</strong>
                <button
                  type="button"
                  aria-label="查看商品"
                  @click.stop="emit('openProduct', product.id)"
                >
                  +
                </button>
              </footer>
            </div>
          </article>
        </section>
      </div>
      <div v-else class="product-empty">暂无商品</div>
    </main>
  </section>
</template>

<style scoped>
.catalog-category-workspace {
  display: grid;
  height: calc(100vh - 138px);
  height: calc(100dvh - 138px);
  min-height: 520px;
  grid-template-columns: 82px minmax(0, 1fr);
  overflow: hidden;
  border-top: 1px solid #f0efed;
  background: #fff;
}

.category-rail {
  display: flex;
  height: 100%;
  padding-bottom: 24px;
  overflow-y: auto;
  flex-direction: column;
  gap: 0;
  background: #fff;
  scrollbar-width: none;
}

.category-rail::-webkit-scrollbar {
  width: 0;
  height: 0;
  background: transparent;
}

.category-rail button {
  display: grid;
  min-height: 62px;
  padding: 10px 4px;
  place-items: center;
  gap: 3px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #aaa6a1;
}

.category-rail button.is-active {
  background: #fff;
  box-shadow: inset -3px 0 #c7a45b;
  color: #2d2926;
}

.category-rail strong {
  max-width: 76px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
}

.category-rail small {
  color: #aaa6a1;
  font-size: 9px;
}

.product-pane {
  min-width: 0;
  height: 100%;
  padding: 0 12px 28px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.product-pane__title {
  display: flex;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid #f0efed;
}

.product-pane__title small {
  color: #ae7259;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.product-pane__title h1 {
  margin: 3px 0 0;
  color: #292522;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 20px;
}

.product-pane__title > span {
  padding: 5px 8px;
  border-radius: 999px;
  background: #f4e6d8;
  color: #9e6249;
  flex: none;
  font-size: 10px;
}

.product-groups {
  display: grid;
  gap: 0;
}

.product-group > h2 {
  position: sticky;
  z-index: 2;
  top: 0;
  margin: 0;
  padding: 8px 4px;
  border-bottom: 1px solid #f0efed;
  background: rgb(255 255 255 / 96%);
  color: #8f847b;
  font-size: 11px;
  font-weight: 500;
}

.product-row {
  display: grid;
  min-width: 0;
  min-height: 126px;
  grid-template-columns: 104px minmax(0, 1fr);
  overflow: hidden;
  border-bottom: 1px solid #f0efed;
  background: #fff;
}

.product-row__image {
  min-height: 126px;
  overflow: hidden;
  background: #faf7f2;
}

.product-row__image img {
  width: 100%;
  height: 100%;
  padding: 8px;
  object-fit: contain;
}

.product-row__image span {
  display: grid;
  height: 100%;
  place-items: center;
  color: #b2775c;
  font-size: 10px;
}

.product-row__content {
  display: flex;
  min-width: 0;
  padding: 20px 4px 12px 12px;
  flex-direction: column;
}

.product-row h3 {
  margin: 0;
  color: #292522;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.35;
}

.product-row p {
  display: -webkit-box;
  overflow: hidden;
  margin: 3px 0 7px;
  color: #292522;
  font-size: 10px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.product-row footer {
  display: flex;
  margin-top: auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.product-row footer strong {
  color: #292522;
  font-size: 12px;
  font-weight: 500;
}

.product-row footer button {
  display: grid;
  width: 22px;
  height: 22px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: #d9b45b;
  color: #fff;
  font-size: 16px;
  line-height: 1;
}

.product-empty,
.category-empty {
  padding: 54px 14px;
  color: #91847a;
  text-align: center;
}

.category-empty {
  margin: 0;
  padding: 30px 14px;
  font-size: 12px;
}
</style>
