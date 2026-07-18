import { describe, expect, it } from 'vitest';

import CategoriesView from '../views/CategoriesView.vue';
import ProductEditorView from '../views/products/ProductEditorView.vue';
import ProductsView from '../views/products/ProductsView.vue';
import { router } from './index.js';

type LazyViewModule = {
  readonly default: unknown;
};

type LazyViewLoader = () => Promise<LazyViewModule>;

describe('admin category route', () => {
  it('lazy-loads the real category management view', async () => {
    const categoryRecord = router
      .resolve('/categories')
      .matched.find((record) => record.name === 'admin-categories');
    const component = categoryRecord?.components?.default;

    expect(typeof component).toBe('function');

    const loaded = await (component as LazyViewLoader)();
    expect(loaded.default).toBe(CategoriesView);
  });
});

describe('admin product routes', () => {
  it.each([
    ['/products', 'admin-products', '商品管理', ProductsView],
    ['/products/new', 'admin-product-new', '新建商品', ProductEditorView],
    [
      '/products/product-1/edit',
      'admin-product-edit',
      '编辑商品',
      ProductEditorView,
    ],
  ])(
    'resolves %s to a protected real view',
    async (path, name, title, view) => {
      const resolved = router.resolve(path);
      const routeRecord = resolved.matched.find(
        (record) => record.name === name,
      );
      const component = routeRecord?.components?.default;

      expect(resolved.name).toBe(name);
      expect(resolved.meta.requiresAdminAuth).toBe(true);
      expect(resolved.meta.title).toBe(title);
      expect(typeof component).toBe('function');

      const loaded = await (component as LazyViewLoader)();
      expect(loaded.default).toBe(view);
    },
  );
});
