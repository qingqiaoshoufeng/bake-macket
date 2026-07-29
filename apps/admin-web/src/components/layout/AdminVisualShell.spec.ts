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

  it('opts a page into workspace layout without changing the default mode', () => {
    const workspace = mount(AdminPage, { props: { workspace: true } });
    const document = mount(AdminPage);

    expect(workspace.get('.admin-page').classes()).toContain(
      'admin-page--workspace',
    );
    expect(document.get('.admin-page').classes()).not.toContain(
      'admin-page--workspace',
    );
  });

  it('keeps header, optional alert and data content in explicit regions', () => {
    const wrapper = mount(AdminPage, {
      props: { workspace: true },
      slots: {
        header: '<div>标题</div>',
        alert: '<div>错误提示</div>',
        default: '<div>数据面板</div>',
      },
    });

    expect(wrapper.get('[data-region="page-header"]').text()).toBe('标题');
    expect(wrapper.get('[data-region="page-alert"]').text()).toBe('错误提示');
    expect(wrapper.get('[data-region="page-content"]').text()).toBe('数据面板');
  });

  it('omits the optional alert region without changing content ownership', () => {
    const wrapper = mount(AdminPage, {
      props: { workspace: true },
      slots: {
        header: '<div>标题</div>',
        default: '<div>数据面板</div>',
      },
    });

    expect(wrapper.find('[data-region="page-alert"]').exists()).toBe(false);
    expect(wrapper.get('[data-region="page-content"]').text()).toBe('数据面板');
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

  it('opts a data panel into fill layout and removes the outer scroll class', () => {
    const fillPanel = mount(AdminDataPanel, {
      props: { fill: true },
      slots: { default: '<div>table</div>' },
    });
    const regularPanel = mount(AdminDataPanel, {
      slots: { default: '<div>table</div>' },
    });

    expect(fillPanel.get('.admin-data-panel').classes()).toContain(
      'admin-data-panel--fill',
    );
    expect(fillPanel.get('[data-region="data"]').classes()).not.toContain(
      'admin-horizontal-scroll',
    );
    expect(regularPanel.get('.admin-data-panel').classes()).not.toContain(
      'admin-data-panel--fill',
    );
    expect(regularPanel.get('[data-region="data"]').classes()).toContain(
      'admin-horizontal-scroll',
    );
  });

  it('renders explicit empty state copy', () => {
    const wrapper = mount(AdminEmptyState, {
      props: { title: '暂无商品', description: '先创建第一件商品' },
    });

    expect(wrapper.text()).toContain('暂无商品');
  });
});
