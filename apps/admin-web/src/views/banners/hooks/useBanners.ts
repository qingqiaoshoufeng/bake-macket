import {
  BannerTargetType,
  type AdminBannerView,
  type AdminCategoryView,
  type AdminProductSummaryView,
  type SaveBannerRequest,
} from '@bake-mall/contracts';
import { computed, reactive, ref } from 'vue';

import { adminCatalogApi } from '../../../api/catalog.js';
import { productsApi } from '../../products/api/index.js';
import { bannersApi } from '../api/index.js';
import { createBannerDefaults } from '../config/defaults.js';
import type { BannerFormShape, BannerTargetOption } from '../type/form.js';

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
  if (form.targetType === BannerTargetType.PRODUCT) {
    return {
      ...common,
      targetType: BannerTargetType.PRODUCT,
      targetId: form.targetId,
    };
  }
  return {
    ...common,
    targetType: BannerTargetType.CATEGORY,
    targetId: form.targetId,
  };
};

export function useBanners() {
  const banners = ref<readonly AdminBannerView[]>([]);
  const categories = ref<readonly AdminCategoryView[]>([]);
  const products = ref<readonly AdminProductSummaryView[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const uploading = ref(false);
  const lastError = ref<string | null>(null);
  const dialogVisible = ref(false);
  const editingId = ref<string | null>(null);
  const refreshSequence = ref(0);
  const form = reactive<BannerFormShape>(createBannerDefaults());

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

  async function refresh(): Promise<void> {
    const sequence = refreshSequence.value + 1;
    refreshSequence.value = sequence;
    loading.value = true;
    lastError.value = null;
    try {
      const [bannerRows, categoryRows, productRows] = await Promise.all([
        bannersApi.list(),
        adminCatalogApi.listCategories(),
        productsApi.list(),
      ]);
      if (sequence !== refreshSequence.value) return;
      banners.value = [...bannerRows];
      categories.value = [...categoryRows];
      products.value = [...productRows];
    } catch {
      if (sequence === refreshSequence.value) {
        lastError.value = 'Banner 数据加载失败，请重试';
      }
    } finally {
      if (sequence === refreshSequence.value) loading.value = false;
    }
  }

  async function refreshBanners(): Promise<void> {
    banners.value = [...(await bannersApi.list())];
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
    form.targetType = targetType;
    form.targetId = '';
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
      dialogVisible.value = false;
      await refreshBanners();
      return saved;
    } finally {
      saving.value = false;
    }
  }

  async function toggleActive(banner: AdminBannerView): Promise<void> {
    if (!banner.image) {
      throw new Error('历史 Banner 需要重新上传图片后才能切换状态');
    }
    await bannersApi.update(banner.id, {
      image: banner.image,
      ...(banner.title ? { title: banner.title } : {}),
      targetType: banner.targetType,
      ...(banner.targetType === BannerTargetType.NONE
        ? {}
        : { targetId: banner.targetId }),
      sortOrder: banner.sortOrder,
      isActive: !banner.isActive,
    } as SaveBannerRequest);
    await refreshBanners();
  }

  async function remove(id: string): Promise<void> {
    await bannersApi.remove(id);
    await refreshBanners();
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
    loading,
    saving,
    uploading,
    lastError,
    dialogVisible,
    editingId,
    form,
    targetOptions,
    refresh,
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
