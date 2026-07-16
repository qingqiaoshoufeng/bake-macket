import { ref, type Ref } from 'vue';

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
  readonly product: Ref<CatalogProductDetail | null>;
  readonly loading: Ref<boolean>;
  readonly lastError: Ref<string | null>;
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
  const product = ref<CatalogProductDetail | null>(null);
  const loading = ref(false);
  const lastError = ref<string | null>(null);

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

  async function loadHome(): Promise<void> {
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
    return withLoading(async () => {
      const detail = await catalogFeatureApi.getProduct(id) as CatalogProductDetail;
      product.value = detail;
      return detail;
    });
  }

  return {
    banners,
    categories,
    products,
    product,
    loading,
    lastError,
    loadHome,
    loadProducts,
    loadProduct,
  };
}
