import { ApiErrorCode, type AdminCategoryView } from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../../api/http.js';
import { categoriesApi } from '../../categories/api/index.js';
import { productsApi } from '../api/index.js';
import { PRODUCT_DETAIL_MOCK } from '../mock/detail.mock.js';
import {
  mapDetailToForm,
  mapFormToRequest,
  useProductEditor,
} from './useProductEditor.js';

vi.mock('../api/index.js', () => ({
  productsApi: { getOne: vi.fn(), create: vi.fn(), replace: vi.fn() },
}));
vi.mock('../../categories/api/index.js', () => ({
  categoriesApi: { list: vi.fn() },
}));

const api = vi.mocked(productsApi);
const categoryListMock: AdminCategoryView[] = [
  {
    id: 'category-1',
    name: '蛋糕',
    sortOrder: 0,
    isActive: true,
  },
];
const categories = vi.mocked(categoriesApi);

function loadedEditor() {
  const editor = useProductEditor({ mode: 'edit', productId: 'product-1' });
  api.getOne.mockResolvedValue(PRODUCT_DETAIL_MOCK);
  categories.list.mockResolvedValue(categoryListMock);
  return { editor, load: editor.load() };
}

function newEditor() {
  const editor = useProductEditor({ mode: 'new' });
  categories.list.mockResolvedValue(categoryListMock);
  return { editor, load: editor.load() };
}

describe('useProductEditor', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('preserves existing non-continuous image sort orders through detail and request mappings', () => {
    const detail = {
      ...PRODUCT_DETAIL_MOCK,
      images: [
        { ...PRODUCT_DETAIL_MOCK.images[0], sortOrder: 4 },
        {
          ...PRODUCT_DETAIL_MOCK.images[0],
          id: 'product-image-2',
          objectKey: 'products/strawberry-2.webp',
          publicUrl: 'https://cdn.example.com/products/strawberry-2.webp',
          sortOrder: 9,
        },
      ],
    };

    const form = mapDetailToForm(detail);

    expect(form.images).toMatchObject([
      { id: 'product-image-1', sortOrder: 4 },
      { id: 'product-image-2', sortOrder: 9 },
    ]);
    expect(mapFormToRequest(form).images).toEqual([
      {
        id: 'product-image-1',
        objectKey: 'products/strawberry-1.webp',
        publicUrl: 'https://cdn.example.com/products/strawberry-1.webp',
        sortOrder: 4,
      },
      {
        id: 'product-image-2',
        objectKey: 'products/strawberry-2.webp',
        publicUrl: 'https://cdn.example.com/products/strawberry-2.webp',
        sortOrder: 9,
      },
    ]);
  });

  it('maps detail to form and submits exact integer-cent aggregate input', async () => {
    const { editor, load } = loadedEditor();
    await load;

    expect(editor.form.value.skus[0]).toMatchObject({
      id: 'sku-1',
      stockVersion: 4,
      priceYuan: '68.50',
      stock: 0,
    });
    api.replace.mockResolvedValue(PRODUCT_DETAIL_MOCK);

    await editor.save();

    expect(api.replace).toHaveBeenCalledWith(
      'product-1',
      expect.objectContaining({
        skus: [
          expect.objectContaining({
            id: 'sku-1',
            stockVersion: 4,
            priceCents: 6850,
            stock: 0,
          }),
        ],
        deletedSkuIds: [],
      }),
    );
  });

  it('keeps load and non-conflict save errors separate without replacing the draft', async () => {
    const editor = useProductEditor({ mode: 'new' });
    categories.list.mockRejectedValueOnce(new Error('分类加载失败'));

    await editor.load();

    expect(editor.loadError.value).toEqual(new Error('分类加载失败'));
    expect(editor.saveError.value).toBeNull();

    categories.list.mockResolvedValueOnce(categoryListMock);
    await editor.load();
    editor.replaceForm({
      ...mapDetailToForm(PRODUCT_DETAIL_MOCK),
      name: '未保存草稿',
      categoryId: 'category-1',
      isActive: false,
    });
    const saveError = new ApiClientError(500, '服务暂时不可用');
    api.create.mockRejectedValueOnce(saveError);

    await expect(editor.save()).rejects.toBe(saveError);
    expect(editor.loadError.value).toBeNull();
    expect(editor.saveError.value).toBe(saveError);
    expect(editor.form.value.name).toBe('未保存草稿');
  });

  it('keeps the draft on 409 and reloads only after explicit action', async () => {
    const { editor, load } = loadedEditor();
    await load;
    api.replace.mockRejectedValueOnce(
      new ApiClientError(409, '库存已发生变化，请重新加载后再保存', {
        code: ApiErrorCode.PRODUCT_STOCK_CONFLICT,
      }),
    );
    editor.setName('未保存草稿');

    await expect(editor.save()).rejects.toThrow();
    expect(editor.form.value.name).toBe('未保存草稿');
    expect(editor.stockConflict.value).toBe(true);
    expect(api.getOne).toHaveBeenCalledTimes(1);

    api.getOne.mockResolvedValue(PRODUCT_DETAIL_MOCK);
    await editor.reload();
    expect(api.getOne).toHaveBeenCalledWith('product-1');
    expect(editor.form.value.name).toBe(PRODUCT_DETAIL_MOCK.name);
  });

  it('uses the server response as form and sanitized preview', async () => {
    const { editor, load } = newEditor();
    await load;
    api.create.mockResolvedValue({
      ...PRODUCT_DETAIL_MOCK,
      detailHtml: '<p>clean</p>',
    });

    editor.replaceForm({
      ...mapDetailToForm(PRODUCT_DETAIL_MOCK),
      name: '新品',
      categoryId: 'category-1',
      isActive: false,
    });
    await editor.save();

    expect(editor.form.value.detailHtml).toBe('<p>clean</p>');
    expect(editor.savedPreviewHtml.value).toBe('<p>clean</p>');
  });

  it('loads edit detail into the draft without treating it as a saved response', async () => {
    const { editor, load } = loadedEditor();
    await load;

    expect(categories.list).toHaveBeenCalledOnce();
    expect(api.getOne).toHaveBeenCalledWith('product-1');
    expect(editor.categories.value).toEqual(categoryListMock);
    expect(editor.form.value.detailHtml).toBe(PRODUCT_DETAIL_MOCK.detailHtml);
    expect(editor.savedPreviewHtml.value).toBe('');
  });

  it('rejects every product without at least one SKU before the API call', async () => {
    const { editor, load } = newEditor();
    await load;
    editor.replaceForm({
      ...editor.form.value,
      name: '下架新品',
      categoryId: 'category-1',
      isActive: false,
      skus: [],
    });

    await expect(editor.save()).rejects.toThrow('至少需要一个 SKU');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('rejects active products without active SKUs before the API call', async () => {
    const { editor, load } = newEditor();
    await load;
    editor.replaceForm({
      ...editor.form.value,
      name: '新品',
      categoryId: 'category-1',
      isActive: true,
    });

    await expect(editor.save()).rejects.toThrow('至少需要一个上架 SKU');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('does not save while an upload is in flight', async () => {
    const { editor, load } = newEditor();
    await load;
    editor.setUploading(true);

    await expect(editor.save()).rejects.toThrow('图片上传中');
    expect(api.create).not.toHaveBeenCalled();
  });
});
