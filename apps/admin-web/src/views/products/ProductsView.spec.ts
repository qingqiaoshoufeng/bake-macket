import { flushPromises, mount } from '@vue/test-utils';
import { ElMessage, ElMessageBox } from 'element-plus';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import { categoriesApi } from '../categories/api/index.js';
import { productsApi } from './api/index.js';
import ProductsView from './ProductsView.vue';
import { PRODUCT_LIST_MOCK } from './mock/list.mock.js';

vi.mock('../categories/api/index.js', () => ({
  categoriesApi: { list: vi.fn() },
}));
vi.mock('./api/index.js', () => ({
  productsApi: {
    list: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(productsApi);
const categoryApi = vi.mocked(categoriesApi);

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/products', component: ProductsView },
      { path: '/products/new', component: { template: '<div />' } },
      { path: '/products/:id/edit', component: { template: '<div />' } },
    ],
  });
}

async function mountView() {
  const router = createTestRouter();
  await router.push('/products');
  await router.isReady();
  const wrapper = mount(ProductsView, { global: { plugins: [router] } });
  await flushPromises();
  return { router, wrapper };
}

describe('ProductsView', () => {
  beforeEach(() => {
    categoryApi.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it('uses the shared Admin page, header, and data panel hierarchy', async () => {
    api.list.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    const { wrapper } = await mountView();

    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-page-header').exists()).toBe(true);
    expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
    expect(wrapper.getComponent(AdminPage).props('workspace')).toBe(true);
    expect(wrapper.getComponent(AdminDataPanel).props('fill')).toBe(true);
  });

  it('retries failed loading and navigates to product create and edit pages', async () => {
    api.list
      .mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce({
        items: [...PRODUCT_LIST_MOCK],
        total: PRODUCT_LIST_MOCK.length,
        page: 1,
        pageSize: 20,
      });
    const { router, wrapper } = await mountView();
    const push = vi.spyOn(router, 'push');

    expect(wrapper.get('[data-testid="create-product"]').text()).toContain(
      '新增商品',
    );
    await wrapper.get('[data-testid="retry-products"]').trigger('click');
    await flushPromises();
    expect(api.list).toHaveBeenCalledTimes(2);

    await wrapper.get('[data-testid="create-product"]').trigger('click');
    expect(push).toHaveBeenCalledWith('/products/new');

    await wrapper
      .get('[data-testid="edit-product-product-1"]')
      .trigger('click');
    expect(push).toHaveBeenCalledWith('/products/product-1/edit');
  });

  it.each(['cancel', 'close'])(
    'does not call the API when deletion confirmation is %s',
    async (reason) => {
      api.list.mockResolvedValueOnce({
        items: [...PRODUCT_LIST_MOCK],
        total: PRODUCT_LIST_MOCK.length,
        page: 1,
        pageSize: 20,
      });
      vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce(reason);
      const error = vi.spyOn(ElMessage, 'error');
      const { wrapper } = await mountView();

      await wrapper
        .get('[data-testid="remove-product-product-1"]')
        .trigger('click');
      await flushPromises();

      expect(api.remove).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    },
  );

  it.each([new Error('确认弹窗异常'), 'unknown confirmation failure'])(
    'shows a Chinese error and does not call the API when deletion confirmation rejects unexpectedly',
    async (reason) => {
      api.list.mockResolvedValueOnce({
        items: [...PRODUCT_LIST_MOCK],
        total: PRODUCT_LIST_MOCK.length,
        page: 1,
        pageSize: 20,
      });
      vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce(reason);
      const error = vi.spyOn(ElMessage, 'error');
      const { wrapper } = await mountView();

      await wrapper
        .get('[data-testid="remove-product-product-1"]')
        .trigger('click');
      await flushPromises();

      expect(api.remove).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith('删除确认失败，请重试');
    },
  );

  it('keeps rows and shows a Chinese error when deletion fails', async () => {
    api.list.mockResolvedValueOnce({
      items: [...PRODUCT_LIST_MOCK],
      total: PRODUCT_LIST_MOCK.length,
      page: 1,
      pageSize: 20,
    });
    api.remove.mockRejectedValueOnce(new Error('删除接口不可用'));
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce({} as never);
    const error = vi.spyOn(ElMessage, 'error');
    const { wrapper } = await mountView();

    await wrapper
      .get('[data-testid="remove-product-product-1"]')
      .trigger('click');
    await flushPromises();

    expect(error).toHaveBeenCalledWith('删除商品失败，请重试');
    expect(wrapper.text()).toContain(PRODUCT_LIST_MOCK[0].name);
  });

  it('refreshes after confirmed successful deletion', async () => {
    api.list
      .mockResolvedValueOnce({
        items: [...PRODUCT_LIST_MOCK],
        total: PRODUCT_LIST_MOCK.length,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    api.remove.mockResolvedValueOnce(undefined);
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce({} as never);
    const { wrapper } = await mountView();

    await wrapper
      .get('[data-testid="remove-product-product-1"]')
      .trigger('click');
    await flushPromises();

    expect(api.remove).toHaveBeenCalledWith('product-1');
    expect(api.list).toHaveBeenCalledTimes(2);
  });
});
