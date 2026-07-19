import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { adminCatalogApi } from '../../api/catalog.js';
import { productsApi } from '../products/api/index.js';
import { bannersApi } from './api/index.js';
import BannersView from './BannersView.vue';

vi.mock('../../api/catalog.js', () => ({
  adminCatalogApi: { listCategories: vi.fn() },
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
const catalogApi = vi.mocked(adminCatalogApi);
const productApi = vi.mocked(productsApi);

describe('BannersView', () => {
  afterEach(() => vi.resetAllMocks());

  it('uses the shared Admin page, header, and data panel hierarchy', async () => {
    api.list.mockResolvedValueOnce([]);
    catalogApi.listCategories.mockResolvedValueOnce([]);
    productApi.list.mockResolvedValueOnce([]);

    const wrapper = mount(BannersView);
    await flushPromises();

    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-page-header').exists()).toBe(true);
    expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
  });
});
