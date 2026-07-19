import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { orderListMock } from '../mock/list.mock.js';
import OrderTable from './OrderTable.vue';

describe('OrderTable', () => {
  it('uses the shared Admin table class', () => {
    const wrapper = mount(OrderTable, {
      props: { orders: orderListMock, loading: false },
      global: { directives: { loading: {} } },
    });

    expect(wrapper.get('.el-table').classes()).toContain('admin-table');
  });
});
