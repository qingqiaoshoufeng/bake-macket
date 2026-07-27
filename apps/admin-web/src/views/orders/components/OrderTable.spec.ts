import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { requirePayableTotalCents } from '../hooks/formatters.js';
import { orderListMock } from '../mock/list.mock.js';
import OrderTable from './OrderTable.vue';

describe('OrderTable', () => {
  it('requires the API payable amount instead of falling back to goods total', () => {
    expect(requirePayableTotalCents(orderListMock[0].payableTotalCents)).toBe(
      4120,
    );
    expect(() => requirePayableTotalCents(undefined)).toThrow(
      '订单列表缺少应付金额',
    );
  });

  it('renders the payable amount returned by the API', () => {
    const wrapper = mount(OrderTable, {
      props: { orders: orderListMock, loading: false },
      global: { directives: { loading: {} } },
      slots: {
        default: '<span />',
      },
    });
    const amountColumn = wrapper.findAllComponents({
      name: 'ElTableColumn',
    })[3];
    const amountCell = mount({
      components: { AmountCell: amountColumn.vm.$slots.default },
      template: '<AmountCell :row="row" />',
      setup: () => ({ row: orderListMock[0] }),
    });

    expect(amountCell.text()).toBe('¥41.20');
  });

  it('uses the shared Admin table class', () => {
    const wrapper = mount(OrderTable, {
      props: { orders: orderListMock, loading: false },
      global: { directives: { loading: {} } },
    });

    expect(wrapper.get('.el-table').classes()).toContain('admin-table');
  });
});
