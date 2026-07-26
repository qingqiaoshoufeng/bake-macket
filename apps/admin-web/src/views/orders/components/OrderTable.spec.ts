import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { displayedOrderTotalCents } from '../hooks/formatters.js';
import { orderListMock } from '../mock/list.mock.js';
import OrderTable from './OrderTable.vue';

describe('OrderTable', () => {
  it('shows payable amount instead of pre-discount goods total', () => {
    const wrapper = mount(OrderTable, {
      props: { orders: orderListMock, loading: false },
      global: { directives: { loading: {} } },
    });

    expect(
      displayedOrderTotalCents(
        orderListMock[0].goodsTotalCents,
        orderListMock[0].payableTotalCents,
      ),
    ).toBe(4120);
    expect(wrapper.findComponent({ name: 'ElTableColumn' }).exists()).toBe(
      true,
    );
  });

  it('uses the shared Admin table class', () => {
    const wrapper = mount(OrderTable, {
      props: { orders: orderListMock, loading: false },
      global: { directives: { loading: {} } },
    });

    expect(wrapper.get('.el-table').classes()).toContain('admin-table');
  });
});
