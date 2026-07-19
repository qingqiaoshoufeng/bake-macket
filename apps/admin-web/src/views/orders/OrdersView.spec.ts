import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ordersApi } from './api/index.js';
import OrdersView from './OrdersView.vue';

vi.mock('./api/index.js', () => ({
  ordersApi: {
    list: vi.fn(),
    getOne: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

const api = vi.mocked(ordersApi);

describe('OrdersView', () => {
  afterEach(() => vi.resetAllMocks());

  it('uses the shared Admin page, header, and data panel hierarchy', async () => {
    api.list.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });

    const wrapper = mount(OrdersView, {
      global: { directives: { loading: {} } },
    });
    await flushPromises();

    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-page-header').exists()).toBe(true);
    expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
  });
});
