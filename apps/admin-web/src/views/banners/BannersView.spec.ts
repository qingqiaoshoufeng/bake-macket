import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { categoriesApi } from '../categories/api/index.js';
import { productsApi } from '../products/api/index.js';
import { bannersApi } from './api/index.js';
import BannersView from './BannersView.vue';

vi.mock('../categories/api/index.js', () => ({
  categoriesApi: { list: vi.fn() },
}));
vi.mock('../products/api/index.js', () => ({
  productsApi: { list: vi.fn() },
}));
vi.mock('./api/index.js', () => ({
  bannersApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(bannersApi);
const catalogApi = vi.mocked(categoriesApi);
const productApi = vi.mocked(productsApi);

describe('BannersView', () => {
  afterEach(() => vi.resetAllMocks());

  it('uses the shared Admin page, header, and data panel hierarchy', async () => {
    api.list.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    catalogApi.list.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
    productApi.list.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });

    const wrapper = mount(BannersView);
    await flushPromises();

    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-page-header').exists()).toBe(true);
    expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
  });
});
