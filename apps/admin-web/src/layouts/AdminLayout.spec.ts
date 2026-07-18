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

async function mountAdminLayoutAtEditor() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAdminAuthStore(pinia).accessToken = 'admin-token';
  const router = createTestRouter();
  await router.push('/products/product-1/edit');
  await router.isReady();

  const wrapper = mount(
    { render: () => h(RouterView) },
    {
      global: { plugins: [pinia, router] },
    },
  );
  return { router, wrapper };
}

describe('AdminLayout', () => {
  it('renders the matched editor title and highlights products', async () => {
    const { wrapper } = await mountAdminLayoutAtEditor();

    expect(wrapper.get('[data-testid="admin-page-title"]').text()).toBe(
      '编辑商品',
    );
    expect(wrapper.get('.el-menu-item.is-active').text()).toBe('商品');
    expect(wrapper.get('[data-testid="editor-child"]').text()).toBe(
      '商品编辑内容',
    );
  });

  it('isolates router history between mounts', async () => {
    const first = await mountAdminLayoutAtEditor();
    const second = await mountAdminLayoutAtEditor();

    expect(first.router).not.toBe(second.router);
  });
});
