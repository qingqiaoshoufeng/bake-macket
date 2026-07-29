import { readFileSync } from 'node:fs';

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import MembershipPurchaseTable from './MembershipPurchaseTable.vue';

function readClassStyle(className: string): CSSStyleDeclaration {
  const source = readFileSync(
    `${process.cwd()}/src/views/membership-purchases/components/MembershipPurchaseTable.vue`,
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

describe('MembershipPurchaseTable', () => {
  it('fills the data panel without forcing a business minimum width', () => {
    const wrapper = mount(MembershipPurchaseTable, {
      props: { purchases: [], loading: true },
      global: { directives: { loading: {} } },
    });
    const tableStyle = readClassStyle('membership-purchase-table__table');

    expect(wrapper.get('.el-table').classes()).toContain('admin-table');
    expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBe(
      '100%',
    );
    expect(tableStyle.height).toBe('100%');
    expect(tableStyle.minHeight).toBe('0');
    expect(tableStyle.minWidth).toBe('');
  });
});
