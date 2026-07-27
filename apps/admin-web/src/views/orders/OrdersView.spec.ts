import { flushPromises, mount } from '@vue/test-utils';
import { ElButton } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminFilterPanel from '../../components/filters/AdminFilterPanel.vue';
import { PAGE_SIZE_OPTIONS } from '../../config/pagination.js';
import { ordersApi } from './api/index.js';
import OrderFilters from './components/OrderFilters.vue';
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

  it('uses shared page layout, adaptive filter panel, and pagination options', async () => {
    api.list.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    const wrapper = mount(OrdersView, {
      global: {
        components: { ElButton },
        directives: { loading: {} },
      },
    });
    await flushPromises();

    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-page-header').exists()).toBe(true);
    expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
    expect(
      wrapper
        .findComponent(OrderFilters)
        .findComponent(AdminFilterPanel)
        .exists(),
    ).toBe(true);
    const pagination = wrapper.findComponent({ name: 'ElPagination' });
    expect(pagination.props('pageSizes')).toEqual([...PAGE_SIZE_OPTIONS]);
  });
});
