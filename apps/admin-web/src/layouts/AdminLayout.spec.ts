import { readFileSync } from 'node:fs';

import {
  AdminRole,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  type AdminSessionView,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
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
            meta: {
              requiresAdminAuth: true,
              title: '购卡记录',
              layoutMode: 'workspace',
            },
          },
          {
            path: 'admin-password',
            component: {
              template:
                '<div data-testid="admin-password-child">修改密码内容</div>',
            },
            meta: { requiresAdminAuth: true, title: '修改密码' },
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

const superAdminSession: AdminSessionView = {
  accessToken: 'admin-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.SUPER_ADMIN,
  permissions: SUPER_ADMIN_PERMISSIONS,
  mustChangePassword: false,
};

const operatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

async function mountAdminLayoutAt(
  path: string,
  session: AdminSessionView = superAdminSession,
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAdminAuthStore(pinia).applySession(session, {
    identifier:
      session.role === AdminRole.OPERATOR ? '13800000000' : 'admin@example.com',
  });
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
  it('shows only permission-backed navigation for operators', async () => {
    const { wrapper } = await mountAdminLayoutAt(
      '/membership-purchases',
      operatorSession,
    );

    expect(wrapper.findAll('.el-menu-item').map((item) => item.text())).toEqual(
      ['订单', '用户', '打印设备', '打印记录'],
    );
    expect(wrapper.text()).toContain('13800000000');
    expect(wrapper.text()).not.toContain('商品');
  });

  it('keeps the complete navigation visible for SUPER_ADMIN', async () => {
    const { wrapper } = await mountAdminLayoutAtEditor();

    expect(wrapper.findAll('.el-menu-item')).toHaveLength(11);
    expect(wrapper.text()).toContain('商品');
    expect(wrapper.text()).toContain('用户');
    expect(wrapper.text()).toContain('打印设备');
    expect(wrapper.text()).toContain('会员卡配置');
  });

  it('provides a discoverable password-change action for complete sessions', async () => {
    const { router, wrapper } = await mountAdminLayoutAt(
      '/membership-purchases',
      operatorSession,
    );

    await wrapper.get('[data-testid="admin-change-password"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/admin-password');
  });

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

  it('switches the root layout class from route metadata', async () => {
    const documentLayout = await mountAdminLayoutAtEditor();
    expect(documentLayout.wrapper.get('.admin-layout').classes()).toContain(
      'admin-layout--document',
    );
    expect(documentLayout.wrapper.get('.admin-layout').classes()).not.toContain(
      'admin-layout--workspace',
    );

    const workspaceLayout = await mountAdminLayoutAt('/membership-purchases');
    expect(workspaceLayout.wrapper.get('.admin-layout').classes()).toContain(
      'admin-layout--workspace',
    );
    expect(
      workspaceLayout.wrapper.get('.admin-layout').classes(),
    ).not.toContain('admin-layout--document');
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

  it('lets the workspace canvas fill the desktop track and adds a warning track only below 1024px', () => {
    const source = readFileSync(
      `${process.cwd()}/src/layouts/AdminLayout.vue`,
      'utf8',
    );

    expect(source).toMatch(
      /\.admin-layout--workspace \.admin-layout__main \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/,
    );
    expect(source).toMatch(
      /@media \(max-width: 1023px\) \{[\s\S]*?\.admin-layout--workspace \.admin-layout__main \{[\s\S]*?grid-template-rows: auto auto minmax\(0, 1fr\)/,
    );
  });

  it('isolates router history between mounts', async () => {
    const first = await mountAdminLayoutAtEditor();
    const second = await mountAdminLayoutAtEditor();

    expect(first.router).not.toBe(second.router);
  });
});
