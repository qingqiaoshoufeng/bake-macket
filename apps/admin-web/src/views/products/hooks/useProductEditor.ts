import type {
  AdminCategoryView,
  AdminProductDetailView,
  SaveProductRequest,
  SaveProductSkuInput,
} from '@bake-mall/contracts';
import { ApiErrorCode } from '@bake-mall/contracts';
import { ref, type Ref } from 'vue';

import { ApiClientError } from '../../../api/http.js';
import { formatCentsToYuan } from '../../../utils/money.js';
import { loadAllCategories } from '../../categories/hooks/loadAllCategories.js';
import { productsApi } from '../api/index.js';
import { createDefaultProductForm } from '../config/defaults.js';
import type {
  ProductFormShape,
  SkuAttributeRow,
  SkuFormRow,
} from '../type/form.js';

export type ProductEditorMode =
  | { readonly mode: 'new' }
  | { readonly mode: 'edit'; readonly productId: string };

export type UseProductEditorResult = {
  readonly form: Ref<ProductFormShape>;
  readonly categories: Ref<readonly AdminCategoryView[]>;
  readonly loading: Ref<boolean>;
  readonly saving: Ref<boolean>;
  readonly uploading: Ref<boolean>;
  readonly loadError: Ref<unknown | null>;
  readonly saveError: Ref<unknown | null>;
  readonly stockConflict: Ref<boolean>;
  readonly savedPreviewHtml: Ref<string>;
  readonly load: () => Promise<void>;
  readonly reload: () => Promise<void>;
  readonly save: () => Promise<AdminProductDetailView>;
  readonly replaceForm: (form: ProductFormShape) => void;
  readonly setName: (name: string) => void;
  readonly setUploading: (uploading: boolean) => void;
};

const PRICE_YUAN_PATTERN = /^(0|[1-9]\d*)(\.\d{1,2})?$/;
const MAX_UNSIGNED_INT = 4_294_967_295;
const rowIds = { value: 0 };

function nextRowId(): string {
  rowIds.value += 1;
  return `product-sku-${rowIds.value}`;
}

function parsePriceYuan(value: string): number {
  const normalized = value.trim();
  if (!PRICE_YUAN_PATTERN.test(normalized)) {
    throw new Error('SKU 价格最多保留两位小数');
  }
  const [yuan, decimal = ''] = normalized.split('.');
  const cents =
    Number.parseInt(yuan, 10) * 100 +
    Number.parseInt(decimal.padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(cents) || cents > MAX_UNSIGNED_INT) {
    throw new Error('SKU 价格超出允许范围');
  }
  return cents;
}

function mapAttributes(
  attributes: Record<string, string>,
): readonly SkuAttributeRow[] {
  return Object.entries(attributes).map(([key, value]) => ({ key, value }));
}

function mapSkuToForm(sku: AdminProductDetailView['skus'][number]): SkuFormRow {
  return {
    rowId: nextRowId(),
    id: sku.id,
    stockVersion: sku.stockVersion,
    name: sku.name,
    attributes: mapAttributes(sku.attributes),
    priceYuan: formatCentsToYuan(sku.priceCents),
    stock: sku.stock,
    isActive: sku.isActive,
    image: sku.image ? { ...sku.image } : null,
  };
}

export function mapDetailToForm(
  detail: AdminProductDetailView,
): ProductFormShape {
  return {
    name: detail.name,
    summary: detail.summary ?? '',
    categoryId: detail.categoryId,
    coverImage: detail.coverImage ? { ...detail.coverImage } : null,
    images: detail.images.map((image) => ({
      ...image,
      localId: image.id,
    })),
    detailHtml: detail.detailHtml,
    skus: detail.skus.map(mapSkuToForm),
    sortOrder: detail.sortOrder,
    isActive: detail.isActive,
  };
}

function mapSkuToRequest(row: SkuFormRow): SaveProductSkuInput {
  const attributes = row.attributes.map(({ key, value }) => ({
    key: key.trim(),
    value: value.trim(),
  }));
  const fields = {
    name: row.name.trim(),
    attributes: Object.fromEntries(
      attributes.map(({ key, value }) => [key, value]),
    ),
    priceCents: parsePriceYuan(row.priceYuan),
    stock: row.stock,
    isActive: row.isActive,
    image: row.image ? { ...row.image } : null,
  };
  if (row.id !== undefined) {
    if (row.stockVersion === undefined) {
      throw new Error('已有 SKU 缺少库存版本');
    }
    return { ...fields, id: row.id, stockVersion: row.stockVersion };
  }
  if (row.stockVersion !== undefined) {
    throw new Error('新 SKU 不能包含库存版本');
  }
  return fields;
}

export function mapFormToRequest(form: ProductFormShape): SaveProductRequest {
  const summary = form.summary.trim();
  return {
    name: form.name.trim(),
    ...(summary ? { summary } : {}),
    categoryId: form.categoryId.trim(),
    detailHtml: form.detailHtml.trim(),
    coverImage: form.coverImage ? { ...form.coverImage } : null,
    images: form.images.map((image) => ({
      ...(image.id ? { id: image.id } : {}),
      objectKey: image.objectKey,
      publicUrl: image.publicUrl,
      sortOrder: image.sortOrder,
    })),
    skus: form.skus.map(mapSkuToRequest),
    deletedSkuIds: [],
    sortOrder: form.sortOrder,
    isActive: form.isActive,
  };
}

function validateSku(row: SkuFormRow): readonly string[] {
  const attributes = row.attributes.map(({ key, value }) => ({
    key: key.trim(),
    value: value.trim(),
  }));
  const attributeKeys = attributes.map(({ key }) => key);
  const basicErrors = [
    ...(row.name.trim() ? [] : ['SKU 名称不能为空']),
    ...(!Number.isInteger(row.stock) || row.stock < 0
      ? ['SKU 库存必须是非负整数']
      : []),
    ...(attributes.some(({ key }) => !key) ? ['SKU 属性名不能为空'] : []),
    ...(new Set(attributeKeys).size !== attributeKeys.length
      ? ['SKU 属性名不能重复']
      : []),
    ...(row.id !== undefined && row.stockVersion === undefined
      ? ['已有 SKU 缺少库存版本']
      : []),
    ...(row.id === undefined && row.stockVersion !== undefined
      ? ['新 SKU 不能包含库存版本']
      : []),
  ];
  try {
    parsePriceYuan(row.priceYuan);
    return basicErrors;
  } catch (error) {
    return [
      ...basicErrors,
      error instanceof Error ? error.message : 'SKU 价格不合法',
    ];
  }
}

export function validateProductForm(
  form: ProductFormShape,
  uploading = false,
): readonly string[] {
  return [
    ...(form.name.trim() ? [] : ['商品名称不能为空']),
    ...(form.categoryId.trim() ? [] : ['商品分类不能为空']),
    ...(!Number.isInteger(form.sortOrder) || form.sortOrder < 0
      ? ['排序必须是非负整数']
      : []),
    ...(uploading ? ['图片上传中，请完成后再保存'] : []),
    ...(form.skus.length === 0 ? ['商品至少需要一个 SKU'] : []),
    ...(form.isActive && !form.skus.some((sku) => sku.isActive)
      ? ['至少需要一个上架 SKU']
      : []),
    ...form.skus.flatMap(validateSku),
  ];
}

function cloneForm(form: ProductFormShape): ProductFormShape {
  return {
    ...form,
    coverImage: form.coverImage ? { ...form.coverImage } : null,
    images: form.images.map((image) => ({ ...image })),
    skus: form.skus.map((sku) => ({
      ...sku,
      attributes: sku.attributes.map((attribute) => ({ ...attribute })),
      image: sku.image ? { ...sku.image } : null,
    })),
  };
}

function isStockConflict(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 409 &&
    error.code === ApiErrorCode.PRODUCT_STOCK_CONFLICT
  );
}

export function useProductEditor(
  mode: ProductEditorMode,
  onCreated: (productId: string) => void = () => undefined,
): UseProductEditorResult {
  const form = ref<ProductFormShape>(createDefaultProductForm());
  const categories = ref<readonly AdminCategoryView[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const uploading = ref(false);
  const loadError = ref<unknown | null>(null);
  const saveError = ref<unknown | null>(null);
  const stockConflict = ref(false);
  const savedPreviewHtml = ref('');
  let currentLoad = 0;
  let currentSave = 0;
  let persistedProductId = mode.mode === 'edit' ? mode.productId : null;

  function replaceForm(nextForm: ProductFormShape): void {
    form.value = cloneForm(nextForm);
  }

  function setName(name: string): void {
    replaceForm({ ...form.value, name: name.trim() });
  }

  function setUploading(nextUploading: boolean): void {
    uploading.value = nextUploading;
  }

  function applyLoadedDetail(detail: AdminProductDetailView): void {
    replaceForm(mapDetailToForm(detail));
    stockConflict.value = false;
  }

  function applySavedDetail(detail: AdminProductDetailView): void {
    applyLoadedDetail(detail);
    savedPreviewHtml.value = detail.detailHtml;
  }

  async function load(): Promise<void> {
    const loadId = currentLoad + 1;
    currentLoad = loadId;
    loading.value = true;
    loadError.value = null;
    try {
      if (mode.mode === 'edit') {
        const [nextCategories, detail] = await Promise.all([
          loadAllCategories(),
          productsApi.getOne(mode.productId),
        ]);
        if (loadId !== currentLoad) return;
        categories.value = [...nextCategories];
        applyLoadedDetail(detail);
      } else {
        const nextCategories = await loadAllCategories();
        if (loadId !== currentLoad) return;
        categories.value = [...nextCategories];
      }
    } catch (caughtError) {
      if (loadId === currentLoad) loadError.value = caughtError;
    } finally {
      if (loadId === currentLoad) loading.value = false;
    }
  }

  async function reload(): Promise<void> {
    if (mode.mode === 'new') {
      await load();
      return;
    }
    const loadId = currentLoad + 1;
    currentLoad = loadId;
    loading.value = true;
    loadError.value = null;
    try {
      const detail = await productsApi.getOne(mode.productId);
      if (loadId !== currentLoad) return;
      applyLoadedDetail(detail);
    } catch (caughtError) {
      if (loadId === currentLoad) loadError.value = caughtError;
    } finally {
      if (loadId === currentLoad) loading.value = false;
    }
  }

  async function save(): Promise<AdminProductDetailView> {
    const messages = validateProductForm(form.value, uploading.value);
    if (messages.length > 0) throw new Error(messages.join('；'));
    if (saving.value) throw new Error('商品正在保存，请勿重复提交');

    const saveId = currentSave + 1;
    currentSave = saveId;
    saving.value = true;
    saveError.value = null;
    stockConflict.value = false;
    try {
      const request = mapFormToRequest(form.value);
      const response = persistedProductId
        ? await productsApi.replace(persistedProductId, request)
        : await productsApi.create(request);
      if (saveId === currentSave) {
        applySavedDetail(response);
        if (!persistedProductId) {
          persistedProductId = response.id;
          onCreated(response.id);
        }
      }
      return response;
    } catch (caughtError) {
      if (saveId === currentSave) {
        saveError.value = caughtError;
        stockConflict.value = isStockConflict(caughtError);
      }
      throw caughtError;
    } finally {
      if (saveId === currentSave) saving.value = false;
    }
  }

  return {
    form,
    categories,
    loading,
    saving,
    uploading,
    loadError,
    saveError,
    stockConflict,
    savedPreviewHtml,
    load,
    reload,
    save,
    replaceForm,
    setName,
    setUploading,
  };
}
