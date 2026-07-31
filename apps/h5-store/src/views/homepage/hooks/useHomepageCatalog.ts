import { onScopeDispose, ref, type Ref } from 'vue';

import { catalogFeatureApi } from '../../catalog/api/index.js';
import type {
  CatalogBanner,
  CatalogCategory,
  CatalogProduct,
} from '../../catalog/type/index.js';

type HomepageCatalogErrors = Readonly<{
  banners: string | null;
  categories: string | null;
  products: string | null;
}>;

export type UseHomepageCatalogResult = {
  readonly banners: Ref<readonly CatalogBanner[]>;
  readonly categories: Ref<readonly CatalogCategory[]>;
  readonly products: Ref<readonly CatalogProduct[]>;
  readonly loading: Ref<boolean>;
  readonly errors: Ref<HomepageCatalogErrors>;
  readonly load: () => Promise<void>;
};

const EMPTY_ERRORS: HomepageCatalogErrors = {
  banners: null,
  categories: null,
  products: null,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function settledError<T>(
  result: PromiseSettledResult<T>,
  fallback: string,
): string | null {
  return result.status === 'rejected'
    ? errorMessage(result.reason, fallback)
    : null;
}

function hasAvailableSku(product: CatalogProduct): boolean {
  return product.skus.some(({ isAvailable }) => isAvailable);
}

export function useHomepageCatalog(): UseHomepageCatalogResult {
  const banners = ref<readonly CatalogBanner[]>([]);
  const categories = ref<readonly CatalogCategory[]>([]);
  const products = ref<readonly CatalogProduct[]>([]);
  const loading = ref(false);
  const errors = ref<HomepageCatalogErrors>(EMPTY_ERRORS);
  let activeRequestSequence = 0;
  let disposed = false;

  async function load(): Promise<void> {
    const requestSequence = activeRequestSequence + 1;
    activeRequestSequence = requestSequence;
    if (disposed) return;

    loading.value = true;
    errors.value = EMPTY_ERRORS;

    const [bannerResult, categoryResult, productResult] =
      await Promise.allSettled([
        catalogFeatureApi.listBanners(),
        catalogFeatureApi.listCategories(),
        catalogFeatureApi.listProducts(),
      ] as const);

    if (disposed || requestSequence !== activeRequestSequence) return;

    if (bannerResult.status === 'fulfilled') {
      banners.value = [...bannerResult.value];
    }
    if (categoryResult.status === 'fulfilled') {
      categories.value = [...categoryResult.value];
    }
    if (productResult.status === 'fulfilled') {
      products.value = productResult.value.filter(hasAvailableSku);
    }

    errors.value = {
      banners: settledError(bannerResult, 'Banner 加载失败，请稍后重试'),
      categories: settledError(categoryResult, '分类加载失败，请稍后重试'),
      products: settledError(productResult, '商品内容加载失败，请稍后重试'),
    };
    loading.value = false;
  }

  onScopeDispose(() => {
    disposed = true;
    activeRequestSequence += 1;
  });

  return { banners, categories, products, loading, errors, load };
}
