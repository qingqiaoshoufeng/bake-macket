import {
  ProductStockFilter,
  type AdminProductListQuery,
  type AdminProductSummaryView,
} from '@bake-mall/contracts';
import { computed, reactive, ref, type Ref } from 'vue';

import { countActiveFilters } from '../../../utils/list-query.js';
import { yuanTextToCents } from '../../../utils/money.js';
import { loadAllCategories } from '../../categories/hooks/loadAllCategories.js';
import { productsApi } from '../api/index.js';
import { createProductFilterDefaults } from '../config/defaults.js';
import { PRODUCT_PAGINATION } from '../config/pagination.js';
import type { ProductFilterForm } from '../type/list.js';

const cloneFilters = (filters: ProductFilterForm): ProductFilterForm => ({
  ...filters,
  createdAtRange: filters.createdAtRange ? [...filters.createdAtRange] : null,
});

const optionalYuanTextToCents = (value: string): number | undefined =>
  value.trim() ? yuanTextToCents(value) : undefined;

export const toProductListQuery = (
  filters: ProductFilterForm,
  page: number,
  pageSize: number,
): AdminProductListQuery => {
  const minPriceCents = optionalYuanTextToCents(filters.minPriceYuan);
  const maxPriceCents = optionalYuanTextToCents(filters.maxPriceYuan);
  return {
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.isActive ? { isActive: filters.isActive } : {}),
    ...(filters.hasActiveSku ? { hasActiveSku: filters.hasActiveSku } : {}),
    ...(filters.stock
      ? {
          stock: filters.stock,
          ...(filters.stock === ProductStockFilter.LOW_STOCK
            ? { lowStockThreshold: 10 }
            : {}),
        }
      : {}),
    ...(filters.hasCoverImage ? { hasCoverImage: filters.hasCoverImage } : {}),
    ...(minPriceCents === undefined ? {} : { minPriceCents }),
    ...(maxPriceCents === undefined ? {} : { maxPriceCents }),
    ...(filters.createdAtRange
      ? {
          createdAtFrom: filters.createdAtRange[0],
          createdAtBefore: filters.createdAtRange[1],
        }
      : {}),
    page,
    pageSize,
  };
};

export type UseProductsListResult = {
  readonly products: Ref<readonly AdminProductSummaryView[]>;
  readonly categories: Ref<
    readonly import('@bake-mall/contracts').AdminCategoryView[]
  >;
  readonly draftFilters: ProductFilterForm;
  readonly advancedCount: Readonly<Ref<number>>;
  readonly hasAppliedFilters: Readonly<Ref<boolean>>;
  readonly page: Ref<number>;
  readonly pageSize: Ref<number>;
  readonly total: Ref<number>;
  readonly loading: Ref<boolean>;
  readonly deletingId: Ref<string | null>;
  readonly lastError: Ref<string | null>;
  readonly initialize: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly search: () => Promise<void>;
  readonly reset: () => Promise<void>;
  readonly setPage: (value: number) => Promise<void>;
  readonly setPageSize: (value: number) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
};

export function useProductsList(): UseProductsListResult {
  const products = ref<readonly AdminProductSummaryView[]>([]);
  const categories = ref<
    readonly import('@bake-mall/contracts').AdminCategoryView[]
  >([]);
  const draftFilters = reactive<ProductFilterForm>(
    createProductFilterDefaults(),
  );
  const appliedFilters = ref<ProductFilterForm>(createProductFilterDefaults());
  const page = ref<number>(PRODUCT_PAGINATION.defaultPage);
  const pageSize = ref<number>(PRODUCT_PAGINATION.defaultPageSize);
  const total = ref(0);
  const loading = ref(false);
  const deletingId = ref<string | null>(null);
  const lastError = ref<string | null>(null);
  let refreshSequence = 0;

  const advancedCount = computed(() =>
    countActiveFilters({
      hasActiveSku: appliedFilters.value.hasActiveSku,
      stock: appliedFilters.value.stock,
      hasCoverImage: appliedFilters.value.hasCoverImage,
      minPriceYuan: appliedFilters.value.minPriceYuan,
      maxPriceYuan: appliedFilters.value.maxPriceYuan,
      createdAtRange: appliedFilters.value.createdAtRange,
    }),
  );
  const hasAppliedFilters = computed(
    () => countActiveFilters(appliedFilters.value) > 0,
  );

  async function refresh(): Promise<void> {
    const sequence = refreshSequence + 1;
    refreshSequence = sequence;
    loading.value = true;
    lastError.value = null;
    try {
      const result = await productsApi.list(
        toProductListQuery(appliedFilters.value, page.value, pageSize.value),
      );
      if (sequence !== refreshSequence) return;
      products.value = [...result.items];
      page.value = result.page;
      pageSize.value = result.pageSize;
      total.value = result.total;
    } catch {
      if (sequence === refreshSequence) {
        lastError.value = '商品加载失败，请重试';
      }
    } finally {
      if (sequence === refreshSequence) loading.value = false;
    }
  }

  async function initialize(): Promise<void> {
    const categoryPromise = loadAllCategories();
    const listPromise = refresh();
    const categoryResult = await categoryPromise
      .then((value) => ({ status: 'fulfilled' as const, value }))
      .catch(() => ({ status: 'rejected' as const }));
    await listPromise;
    if (categoryResult.status === 'fulfilled') {
      categories.value = [...categoryResult.value];
    } else if (!lastError.value) {
      lastError.value = '分类选项加载失败，请重试';
    }
  }

  async function search(): Promise<void> {
    const nextFilters = cloneFilters(draftFilters);
    toProductListQuery(nextFilters, 1, pageSize.value);
    appliedFilters.value = nextFilters;
    page.value = 1;
    await refresh();
  }

  async function reset(): Promise<void> {
    const defaults = createProductFilterDefaults();
    Object.assign(draftFilters, defaults);
    appliedFilters.value = defaults;
    page.value = 1;
    await refresh();
  }

  async function setPage(value: number): Promise<void> {
    page.value = value;
    await refresh();
  }

  async function setPageSize(value: number): Promise<void> {
    pageSize.value = value;
    page.value = 1;
    await refresh();
  }

  async function remove(id: string): Promise<void> {
    deletingId.value = id;
    try {
      await productsApi.remove(id);
      await refresh();
    } finally {
      if (deletingId.value === id) deletingId.value = null;
    }
  }

  return {
    products,
    categories,
    draftFilters,
    advancedCount,
    hasAppliedFilters,
    page,
    pageSize,
    total,
    loading,
    deletingId,
    lastError,
    initialize,
    refresh,
    search,
    reset,
    setPage,
    setPageSize,
    remove,
  };
}
