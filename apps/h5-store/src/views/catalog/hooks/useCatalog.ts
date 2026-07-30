import { shallowRef, ref, type Ref, type ShallowRef } from 'vue';

import { catalogFeatureApi } from '../api/index.js';
import type {
  CatalogBanner,
  CatalogCategory,
  CatalogFilter,
  CatalogProduct,
  CatalogProductDetail,
} from '../type/index.js';

export type UseCatalogResult = {
  readonly banners: Ref<readonly CatalogBanner[]>;
  readonly categories: Ref<readonly CatalogCategory[]>;
  readonly products: Ref<readonly CatalogProduct[]>;
  readonly product: ShallowRef<CatalogProductDetail | null>;
  readonly loading: Ref<boolean>;
  readonly lastError: Ref<string | null>;
  readonly loadCatalogLanding: () => Promise<void>;
  /** @deprecated 使用语义明确的 loadCatalogLanding。 */
  readonly loadHome: () => Promise<void>;
  readonly loadProducts: (filter?: CatalogFilter) => Promise<void>;
  readonly loadProduct: (id: string) => Promise<CatalogProductDetail>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '内容加载失败';
}

export function useCatalog(): UseCatalogResult {
  const banners = ref<readonly CatalogBanner[]>([]);
  const categories = ref<readonly CatalogCategory[]>([]);
  const products = ref<readonly CatalogProduct[]>([]);
  const product = shallowRef<CatalogProductDetail | null>(null);
  const loading = ref(false);
  const lastError = ref<string | null>(null);
  let detailSequence = 0;

  async function withLoading<T>(operation: () => Promise<T>): Promise<T> {
    loading.value = true;
    lastError.value = null;
    try {
      return await operation();
    } catch (error) {
      lastError.value = errorMessage(error);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  async function loadCatalogLanding(): Promise<void> {
    await withLoading(async () => {
      const [nextBanners, nextCategories, nextProducts] = await Promise.all([
        catalogFeatureApi.listBanners(),
        catalogFeatureApi.listCategories(),
        catalogFeatureApi.listProducts(),
      ]);
      banners.value = [...nextBanners];
      categories.value = [...nextCategories];
      products.value = [...nextProducts];
    });
  }

  async function loadProducts(filter: CatalogFilter = {}): Promise<void> {
    const q = filter.q?.trim();
    await withLoading(async () => {
      products.value = await catalogFeatureApi.listProducts({
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(q ? { q } : {}),
      });
    });
  }

  async function loadProduct(id: string): Promise<CatalogProductDetail> {
    const sequence = detailSequence + 1;
    detailSequence = sequence;
    product.value = null;
    loading.value = true;
    lastError.value = null;
    try {
      const detail = await catalogFeatureApi.getProduct(id);
      if (sequence === detailSequence) product.value = detail;
      return detail;
    } catch (error) {
      if (sequence === detailSequence) lastError.value = errorMessage(error);
      throw error;
    } finally {
      if (sequence === detailSequence) loading.value = false;
    }
  }

  return {
    banners,
    categories,
    products,
    product,
    loading,
    lastError,
    loadCatalogLanding,
    loadHome: loadCatalogLanding,
    loadProducts,
    loadProduct,
  };
}
