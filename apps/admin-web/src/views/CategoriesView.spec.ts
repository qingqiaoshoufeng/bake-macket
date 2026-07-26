import { mount } from '@vue/test-utils';
import { ElMessage } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { categoriesApi } from './categories/api/index.js';
import CategoriesView from './CategoriesView.vue';

vi.mock('./categories/api/index.js', () => ({
  categoriesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(categoriesApi);

describe('CategoriesView', () => {
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

    const wrapper = mount(CategoriesView);
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-page-header').exists()).toBe(true);
    expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
  });

  it('shows the initial category loading error to the merchant', async () => {
    api.list.mockRejectedValueOnce(new Error('分类接口不可用'));
    const errorMessage = vi.spyOn(ElMessage, 'error');

    mount(CategoriesView);

    await vi.waitFor(() => {
      expect(errorMessage).toHaveBeenCalledWith('分类接口不可用');
    });
  });

  it('does not show an error after a successful initial load', async () => {
    api.list.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const errorMessage = vi.spyOn(ElMessage, 'error');

    mount(CategoriesView);

    await vi.waitFor(() => {
      expect(api.list).toHaveBeenCalledTimes(1);
    });
    expect(errorMessage).not.toHaveBeenCalled();
  });
});
