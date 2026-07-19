import { ApiErrorCode } from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessage } from 'element-plus';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../api/http.js';
import { categoriesApi } from '../categories/api/index.js';
import { productsApi } from './api/index.js';
import ProductEditorView from './ProductEditorView.vue';
import { PRODUCT_DETAIL_MOCK } from './mock/detail.mock.js';

vi.mock('./api/index.js', () => ({
  productsApi: { getOne: vi.fn(), create: vi.fn(), replace: vi.fn() },
}));
vi.mock('../categories/api/index.js', () => ({
  categoriesApi: { list: vi.fn() },
}));

const api = vi.mocked(productsApi);
const categories = vi.mocked(categoriesApi);

async function mountEditor(path = '/products/new') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/products/new', component: ProductEditorView },
      { path: '/products/:id/edit', component: ProductEditorView },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(ProductEditorView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('ProductEditorView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it('shows a loading failure and retries', async () => {
    categories.list
      .mockRejectedValueOnce(new Error('分类加载失败'))
      .mockResolvedValueOnce([]);
    const wrapper = await mountEditor();

    expect(wrapper.text()).toContain('商品加载失败，请重试');
    expect(wrapper.text()).not.toContain('分类加载失败');
    await wrapper.get('[data-testid="retry-editor"]').trigger('click');
    await flushPromises();
    expect(categories.list).toHaveBeenCalledTimes(2);
  });

  it('reloads the editor when the reused route changes to another product', async () => {
    categories.list.mockResolvedValue([]);
    api.getOne.mockImplementation((productId) =>
      Promise.resolve({
        ...PRODUCT_DETAIL_MOCK,
        id: productId,
        name: productId === 'product-2' ? '第二个商品' : '第一个商品',
      }),
    );
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/products/new', component: ProductEditorView },
        { path: '/products/:id/edit', component: ProductEditorView },
      ],
    });
    await router.push('/products/product-1/edit');
    await router.isReady();
    const wrapper = mount(ProductEditorView, { global: { plugins: [router] } });
    await flushPromises();

    await router.push('/products/product-2/edit');
    await flushPromises();

    expect(api.getOne).toHaveBeenLastCalledWith('product-2');
    const form = wrapper.findComponent({ name: 'ProductForm' });
    expect(form.props('form')).toMatchObject({ name: '第二个商品' });
    form.vm.$emit('submit');
    await flushPromises();
    expect(api.replace).toHaveBeenCalledWith('product-2', expect.anything());
  });

  it('renders create and edit titles', async () => {
    categories.list.mockResolvedValue([]);
    expect((await mountEditor()).text()).toContain('新增商品');

    api.getOne.mockResolvedValue(PRODUCT_DETAIL_MOCK);
    expect((await mountEditor('/products/product-1/edit')).text()).toContain(
      '编辑商品',
    );
  });

  it('shows a non-conflict save message without a reload retry and keeps the draft', async () => {
    categories.list.mockResolvedValue([]);
    const saveError = new ApiClientError(500, '服务暂时不可用');
    api.create.mockRejectedValueOnce(saveError);
    const errorMessage = vi.spyOn(ElMessage, 'error');
    const wrapper = await mountEditor();
    const form = wrapper.findComponent({ name: 'ProductForm' });
    form.vm.$emit('update:form', {
      ...form.props('form'),
      name: '未保存草稿',
      categoryId: 'category-1',
      isActive: false,
      skus: PRODUCT_DETAIL_MOCK.skus.map((sku) => ({
        rowId: sku.id,
        id: sku.id,
        stockVersion: sku.stockVersion,
        name: sku.name,
        attributes: Object.entries(sku.attributes).map(([key, value]) => ({
          key,
          value,
        })),
        priceYuan: '68.50',
        stock: sku.stock,
        isActive: sku.isActive,
        image: sku.image,
      })),
    });

    form.vm.$emit('submit');
    await flushPromises();

    expect(errorMessage).toHaveBeenCalledWith('服务暂时不可用');
    expect(wrapper.find('[data-testid="retry-editor"]').exists()).toBe(false);
    expect(form.props('form')).toMatchObject({ name: '未保存草稿' });
  });

  it('shows the conflict action without reloading the draft automatically', async () => {
    categories.list.mockResolvedValue([]);
    api.getOne.mockResolvedValue(PRODUCT_DETAIL_MOCK);
    api.replace.mockRejectedValueOnce(
      new ApiClientError(409, '冲突', {
        code: ApiErrorCode.PRODUCT_STOCK_CONFLICT,
      }),
    );
    const wrapper = await mountEditor('/products/product-1/edit');

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('库存已发生变化，请重新加载后再保存');
    expect(api.getOne).toHaveBeenCalledTimes(1);
  });

  it('reports successful save and only previews response HTML', async () => {
    categories.list.mockResolvedValue([]);
    api.create.mockResolvedValue({
      ...PRODUCT_DETAIL_MOCK,
      detailHtml: '<p>server</p>',
    });
    const success = vi.spyOn(ElMessage, 'success');
    const wrapper = await mountEditor();
    const form = wrapper.findComponent({ name: 'ProductForm' });
    form.vm.$emit('update:form', {
      ...form.props('form'),
      name: '新品',
      categoryId: 'category-1',
      isActive: false,
      skus: PRODUCT_DETAIL_MOCK.skus.map((sku) => ({
        rowId: sku.id,
        id: sku.id,
        stockVersion: sku.stockVersion,
        name: sku.name,
        attributes: Object.entries(sku.attributes).map(([key, value]) => ({
          key,
          value,
        })),
        priceYuan: '68.50',
        stock: sku.stock,
        isActive: sku.isActive,
        image: sku.image,
      })),
    });
    form.vm.$emit('submit');
    await flushPromises();

    expect(success).toHaveBeenCalledWith('商品保存成功');
    expect(wrapper.get('[data-testid="saved-preview"]').html()).toContain(
      '<p>server</p>',
    );
  });
});
