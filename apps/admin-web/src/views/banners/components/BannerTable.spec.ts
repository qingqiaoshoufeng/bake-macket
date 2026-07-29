import { readFileSync } from 'node:fs';

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { bannerListMock } from '../mock/list.mock.js';
import BannerTable from './BannerTable.vue';

function readClassStyle(className: string): CSSStyleDeclaration {
  const source = readFileSync(
    `${process.cwd()}/src/views/banners/components/BannerTable.vue`,
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

describe('BannerTable', () => {
  it('uses the shared Admin table class', () => {
    const wrapper = mount(BannerTable, {
      props: {
        banners: bannerListMock,
        loading: false,
        getTargetLabel: () => '无跳转',
      },
      global: { directives: { loading: {} } },
    });

    expect(wrapper.get('.el-table').classes()).toContain('admin-table');
    const tableStyle = readClassStyle('banner-table__table');

    expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBe(
      '100%',
    );
    expect(tableStyle.height).toBe('100%');
    expect(tableStyle.minHeight).toBe('0');
    expect(tableStyle.minWidth).toBe('');
  });
});
