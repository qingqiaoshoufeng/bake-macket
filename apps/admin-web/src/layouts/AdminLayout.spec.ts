import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { describe, expect, it } from 'vitest';

import { useAdminAuthStore } from '../stores/admin-auth.js';
import AdminLayout from './AdminLayout.vue';

function createTestRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AdminLayout,
        children: [
          {
            path: 'products/:id/edit',
            component: {
              template: '<div data-testid="editor-child">商品编辑内容</div>',
            },
            meta: { requiresAdminAuth: true, title: '编辑商品' },
          },
          {
            path: 'membership-cards/:id/edit',
            component: {
              template:
                '<div data-testid="membership-editor-child">会员卡编辑内容</div>',
            },
            meta: { requiresAdminAuth: true, title: '编辑会员卡' },
          },
          {
            path: 'membership-purchases',
            component: {
              template:
                '<div data-testid="membership-purchases-child">购卡记录内容</div>',
            },
            meta: { requiresAdminAuth: true, title: '购卡记录' },
          },
        ],
      },
    ],
  });
  router.beforeEach((to) => {
    if (!to.meta.requiresAdminAuth) return true;
    return useAdminAuthStore().requireAdminAuth(to.fullPath) ?? true;
  });
  return router;
}

async function mountAdminLayoutAt(path: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAdminAuthStore(pinia).accessToken = 'admin-token';
  const router = createTestRouter();
  await router.push(path);
  await router.isReady();

  const wrapper = mount(
    { render: () => h(RouterView) },
    {
      global: { plugins: [pinia, router] },
    },
  );
  return { router, wrapper };
}

async function mountAdminLayoutAtEditor() {
  return mountAdminLayoutAt('/products/product-1/edit');
}

describe('AdminLayout', () => {
  it('renders the matched editor title and highlights products', async () => {
    const { wrapper } = await mountAdminLayoutAtEditor();

    expect(wrapper.get('[data-testid="admin-page-title"]').text()).toBe(
      '编辑商品',
    );
    wrapper.get('[data-testid="admin-nav"]');
    expect(wrapper.get('.admin-layout__sidebar-version').text()).toBe(
      'v0.1 · MVP',
    );
    const activeMenuItem = wrapper.get('.el-menu-item.is-active');
    expect(activeMenuItem.text()).toContain('商品');
    expect(activeMenuItem.attributes('aria-current')).toBe('page');
    wrapper.get('.admin-layout__canvas');
    expect(wrapper.get('[data-testid="editor-child"]').text()).toBe(
      '商品编辑内容',
    );
  });

  it('renders the membership editor title and highlights membership cards', async () => {
    const { wrapper } = await mountAdminLayoutAt(
      '/membership-cards/level-1/edit',
    );

    expect(wrapper.get('[data-testid="admin-page-title"]').text()).toBe(
      '编辑会员卡',
    );
    const activeMenuItem = wrapper.get('.el-menu-item.is-active');
    expect(activeMenuItem.text()).toContain('会员卡配置');
    expect(activeMenuItem.attributes('aria-current')).toBe('page');
    expect(wrapper.get('[data-testid="membership-editor-child"]').text()).toBe(
      '会员卡编辑内容',
    );
  });

  it('highlights the longest matching membership purchase navigation prefix', async () => {
    const { wrapper } = await mountAdminLayoutAt('/membership-purchases');

    expect(wrapper.get('[data-testid="admin-page-title"]').text()).toBe(
      '购卡记录',
    );
    const activeMenuItem = wrapper.get('.el-menu-item.is-active');
    expect(activeMenuItem.text()).toContain('购卡记录');
    expect(activeMenuItem.attributes('aria-current')).toBe('page');
    expect(
      wrapper.get('[data-testid="membership-purchases-child"]').text(),
    ).toBe('购卡记录内容');
  });

  it('places the narrow-screen warning below the topbar and before content', async () => {
    const { wrapper } = await mountAdminLayoutAtEditor();
    const mainChildren = wrapper
      .get('.admin-layout__main')
      .element.querySelectorAll(':scope > *');

    expect([...mainChildren].map((element) => element.className)).toEqual([
      'admin-layout__topbar',
      'admin-layout__narrow-warning',
      'admin-layout__canvas',
    ]);
    expect(
      wrapper.get('[data-testid="admin-narrow-warning"]').attributes('role'),
    ).toBe('status');
  });

  it('isolates router history between mounts', async () => {
    const first = await mountAdminLayoutAtEditor();
    const second = await mountAdminLayoutAtEditor();

    expect(first.router).not.toBe(second.router);
  });
});
