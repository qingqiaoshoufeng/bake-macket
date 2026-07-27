import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AdminEmptyState from '../feedback/AdminEmptyState.vue';
import AdminDataPanel from './AdminDataPanel.vue';
import AdminPage from './AdminPage.vue';
import AdminPageHeader from './AdminPageHeader.vue';

describe('Admin visual shell', () => {
  it('provides a consistent page content container', () => {
    const wrapper = mount(AdminPage, {
      slots: { default: '<div>页面内容</div>' },
    });

    expect(wrapper.get('.admin-page').text()).toContain('页面内容');
  });

  it('provides a consistent page hierarchy and action slot', () => {
    const wrapper = mount(AdminPageHeader, {
      props: {
        eyebrow: 'CATALOG',
        title: '商品管理',
        description: '维护商品',
      },
      slots: { actions: '<button>新增商品</button>' },
    });

    expect(wrapper.get('h1').text()).toBe('商品管理');
    expect(wrapper.text()).toContain('新增商品');
  });

  it('separates toolbar, data and footer regions', () => {
    const wrapper = mount(AdminDataPanel, {
      slots: {
        toolbar: '<div>filters</div>',
        default: '<div>table</div>',
        footer: '<div>pager</div>',
      },
    });

    expect(wrapper.find('[data-region="toolbar"]').exists()).toBe(true);
    expect(wrapper.find('[data-region="data"]').exists()).toBe(true);
    expect(wrapper.find('[data-region="footer"]').exists()).toBe(true);
  });

  it('renders explicit empty state copy', () => {
    const wrapper = mount(AdminEmptyState, {
      props: { title: '暂无商品', description: '先创建第一件商品' },
    });

    expect(wrapper.text()).toContain('暂无商品');
  });
});
