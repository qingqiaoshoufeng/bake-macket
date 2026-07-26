import {
  BannerTargetType,
  type AdminBannerListQuery,
  type AdminBannerView,
  type AdminCategoryView,
  type AdminProductSummaryView,
  type SaveBannerRequest,
} from '@bake-mall/contracts';
import { computed, reactive, ref } from 'vue';

import { countActiveFilters } from '../../../utils/list-query.js';
import { loadAllCategories } from '../../categories/hooks/loadAllCategories.js';
import { loadAllProducts } from '../../products/hooks/loadAllProducts.js';
import { bannersApi } from '../api/index.js';
import {
  createBannerDefaults,
  createBannerFilterDefaults,
} from '../config/defaults.js';
import { BANNER_PAGINATION } from '../config/pagination.js';
import type { BannerFormShape, BannerTargetOption } from '../type/form.js';
import type { BannerFilterForm } from '../type/list.js';

const toForm = (banner: AdminBannerView): BannerFormShape => ({
  image: banner.image ? { ...banner.image } : null,
  title: banner.title ?? '',
  targetType: banner.targetType,
  targetId: banner.targetType === BannerTargetType.NONE ? '' : banner.targetId,
  sortOrder: banner.sortOrder,
  isActive: banner.isActive,
});

const replaceForm = (form: BannerFormShape, next: BannerFormShape): void => {
  Object.assign(form, next);
};

const cloneFilters = (filters: BannerFilterForm): BannerFilterForm => ({
  ...filters,
  createdAtRange: filters.createdAtRange ? [...filters.createdAtRange] : null,
});

const toQuery = (
  filters: BannerFilterForm,
  page: number,
  pageSize: number,
): AdminBannerListQuery => ({
  ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
  ...(filters.isActive ? { isActive: filters.isActive } : {}),
  ...(filters.targetType ? { targetType: filters.targetType } : {}),
  ...(filters.targetId ? { targetId: filters.targetId } : {}),
  ...(filters.targetValid ? { targetValid: filters.targetValid } : {}),
  ...(filters.createdAtRange
    ? {
        createdAtFrom: filters.createdAtRange[0],
        createdAtBefore: filters.createdAtRange[1],
      }
    : {}),
  page,
  pageSize,
});

const toRequest = (form: BannerFormShape): SaveBannerRequest => {
  if (!form.image) throw new Error('请先上传 Banner 图片');
  const common = {
    image: { ...form.image },
    ...(form.title.trim() ? { title: form.title.trim() } : {}),
    sortOrder: form.sortOrder,
    isActive: form.isActive,
  };
  if (form.targetType === BannerTargetType.NONE) {
    return { ...common, targetType: BannerTargetType.NONE };
  }
  if (!form.targetId) throw new Error('请选择跳转目标');
  return {
    ...common,
    targetType: form.targetType,
    targetId: form.targetId,
  } as SaveBannerRequest;
};

export function useBanners() {
  const banners = ref<readonly AdminBannerView[]>([]);
  const categories = ref<readonly AdminCategoryView[]>([]);
  const products = ref<readonly AdminProductSummaryView[]>([]);
  const draftFilters = reactive<BannerFilterForm>(createBannerFilterDefaults());
  const appliedFilters = ref<BannerFilterForm>(createBannerFilterDefaults());
  const page = ref<number>(BANNER_PAGINATION.defaultPage);
  const pageSize = ref<number>(BANNER_PAGINATION.defaultPageSize);
  const total = ref(0);
  const loading = ref(false);
  const saving = ref(false);
  const uploading = ref(false);
  const lastError = ref<string | null>(null);
  const dialogVisible = ref(false);
  const editingId = ref<string | null>(null);
  const form = reactive<BannerFormShape>(createBannerDefaults());
  let refreshSequence = 0;

  const validCategories = computed(() =>
    categories.value.filter((category) => category.isActive),
  );
  const validProducts = computed(() => {
    const activeCategoryIds = new Set(
      validCategories.value.map((category) => category.id),
    );
    return products.value.filter(
      (product) =>
        product.isActive && activeCategoryIds.has(product.categoryId),
    );
  });
  const productNames = computed(
    () => new Map(products.value.map((product) => [product.id, product.name])),
  );
  const categoryNames = computed(
    () =>
      new Map(categories.value.map((category) => [category.id, category.name])),
  );
  const getOptions = (
    targetType: '' | BannerTargetType,
  ): readonly BannerTargetOption[] => {
    if (targetType === BannerTargetType.PRODUCT) {
      return products.value.map((product) => ({
        id: product.id,
        label: `${product.name} · ${product.categoryName}`,
      }));
    }
    if (targetType === BannerTargetType.CATEGORY) {
      return categories.value.map((category) => ({
        id: category.id,
        label: category.name,
      }));
    }
    return [];
  };
  const targetOptions = computed<readonly BannerTargetOption[]>(() => {
    if (form.targetType === BannerTargetType.PRODUCT) {
      return validProducts.value.map((product) => ({
        id: product.id,
        label: `${product.name} · ${product.categoryName}`,
      }));
    }
    if (form.targetType === BannerTargetType.CATEGORY) {
      return validCategories.value.map((category) => ({
        id: category.id,
        label: category.name,
      }));
    }
    return [];
  });
  const filterTargetOptions = computed(() =>
    getOptions(draftFilters.targetType),
  );
  const advancedCount = computed(() =>
    countActiveFilters({
      targetId: appliedFilters.value.targetId,
      targetValid: appliedFilters.value.targetValid,
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
      const result = await bannersApi.list(
        toQuery(appliedFilters.value, page.value, pageSize.value),
      );
      if (sequence !== refreshSequence) return;
      banners.value = [...result.items];
      page.value = result.page;
      pageSize.value = result.pageSize;
      total.value = result.total;
    } catch {
      if (sequence === refreshSequence) {
        lastError.value = 'Banner 数据加载失败，请重试';
      }
    } finally {
      if (sequence === refreshSequence) loading.value = false;
    }
  }

  async function initialize(): Promise<void> {
    const listPromise = refresh();
    const [categoryResult, productResult] = await Promise.allSettled([
      loadAllCategories(),
      loadAllProducts(),
    ]);
    await listPromise;
    if (categoryResult.status === 'fulfilled') {
      categories.value = [...categoryResult.value];
    }
    if (productResult.status === 'fulfilled') {
      products.value = [...productResult.value];
    }
    if (
      categoryResult.status === 'rejected' ||
      productResult.status === 'rejected'
    ) {
      lastError.value ??= 'Banner 跳转选项加载失败，请重试';
    }
  }

  async function search(): Promise<void> {
    appliedFilters.value = cloneFilters(draftFilters);
    page.value = 1;
    await refresh();
  }

  async function reset(): Promise<void> {
    const defaults = createBannerFilterDefaults();
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

  function setFilterTargetType(targetType: '' | BannerTargetType): void {
    Object.assign(draftFilters, { targetType, targetId: '' });
  }

  function applyBanner(saved: AdminBannerView): void {
    const exists = banners.value.some((banner) => banner.id === saved.id);
    banners.value = exists
      ? banners.value.map((banner) => (banner.id === saved.id ? saved : banner))
      : [saved, ...banners.value];
  }

  async function refreshBanners(failureMessage: string): Promise<void> {
    const previousError = lastError.value;
    await refresh();
    if (lastError.value) lastError.value = failureMessage;
    else if (previousError) lastError.value = null;
  }

  function openCreate(): void {
    editingId.value = null;
    replaceForm(form, createBannerDefaults());
    dialogVisible.value = true;
  }

  function startEdit(banner: AdminBannerView): void {
    editingId.value = banner.id;
    replaceForm(form, toForm(banner));
    dialogVisible.value = true;
  }

  function closeDialog(): void {
    if (!saving.value && !uploading.value) dialogVisible.value = false;
  }

  function setTargetType(targetType: BannerTargetType): void {
    Object.assign(form, { targetType, targetId: '' });
  }

  function setUploading(value: boolean): void {
    uploading.value = value;
  }

  async function save(): Promise<AdminBannerView> {
    if (uploading.value) throw new Error('图片仍在上传中');
    const request = toRequest(form);
    saving.value = true;
    try {
      const saved = editingId.value
        ? await bannersApi.update(editingId.value, request)
        : await bannersApi.create(request);
      applyBanner(saved);
      dialogVisible.value = false;
      await refreshBanners('Banner 已保存，但列表刷新失败');
      return saved;
    } finally {
      saving.value = false;
    }
  }

  async function toggleActive(banner: AdminBannerView): Promise<void> {
    if (!banner.image) {
      throw new Error('历史 Banner 需要重新上传图片后才能切换状态');
    }
    const saved = await bannersApi.update(banner.id, {
      image: banner.image,
      ...(banner.title ? { title: banner.title } : {}),
      targetType: banner.targetType,
      ...(banner.targetType === BannerTargetType.NONE
        ? {}
        : { targetId: banner.targetId }),
      sortOrder: banner.sortOrder,
      isActive: !banner.isActive,
    } as SaveBannerRequest);
    applyBanner(saved);
    await refreshBanners('Banner 状态已更新，但列表刷新失败');
  }

  async function remove(id: string): Promise<void> {
    await bannersApi.remove(id);
    banners.value = banners.value.filter((banner) => banner.id !== id);
    await refreshBanners('Banner 已删除，但列表刷新失败');
  }

  function getTargetLabel(banner: AdminBannerView): string {
    if (banner.targetType === BannerTargetType.NONE) return '无跳转';
    const names =
      banner.targetType === BannerTargetType.PRODUCT
        ? productNames.value
        : categoryNames.value;
    return names.get(banner.targetId) ?? `已失效 · ${banner.targetId}`;
  }

  return {
    banners,
    categories,
    products,
    draftFilters,
    advancedCount,
    hasAppliedFilters,
    filterTargetOptions,
    page,
    pageSize,
    total,
    loading,
    saving,
    uploading,
    lastError,
    dialogVisible,
    editingId,
    form,
    targetOptions,
    initialize,
    refresh,
    search,
    reset,
    setPage,
    setPageSize,
    setFilterTargetType,
    openCreate,
    startEdit,
    closeDialog,
    setTargetType,
    setUploading,
    save,
    toggleActive,
    remove,
    getTargetLabel,
  };
}
