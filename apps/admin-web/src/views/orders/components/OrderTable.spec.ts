import { readFileSync } from 'node:fs';

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { requirePayableTotalCents } from '../hooks/formatters.js';
import { orderListMock } from '../mock/list.mock.js';
import OrderTable from './OrderTable.vue';

function readClassStyle(className: string): CSSStyleDeclaration {
  const source = readFileSync(
    `${process.cwd()}/src/views/orders/components/OrderTable.vue`,
    'utf8',
  );
  const declarations = source.match(
    new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`),
  )?.[1];
  const style = document.createElement('div').style;

  expect(declarations, `缺少 .${className} 样式规则`).toBeDefined();
  style.cssText = declarations ?? '';
  return style;
}

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
    const amountColumn = wrapper
      .findAllComponents({ name: 'ElTableColumn' })
      .find((column) => column.props('label') === '应付金额');
    expect(amountColumn).toBeDefined();
    const amountCell = mount({
      components: { AmountCell: amountColumn?.vm.$slots.default },
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
    const tableStyle = readClassStyle('order-table__table');

    expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBe(
      '100%',
    );
    expect(tableStyle.height).toBe('100%');
    expect(tableStyle.minHeight).toBe('0');
    expect(tableStyle.minWidth).toBe('');
  });
});
