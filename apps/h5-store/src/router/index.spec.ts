import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { router } from './index.js';

type LazyViewModule = {
  readonly default: { readonly __name?: string };
};

type LazyViewLoader = () => Promise<LazyViewModule>;

const expectedViews = [
  {
    path: '/category/cake',
    routeName: 'category',
    componentName: 'CategoryView',
  },
  {
    path: '/products/product-1',
    routeName: 'product-detail',
    componentName: 'ProductDetailView',
  },
  { path: '/cart', routeName: 'cart', componentName: 'CartView' },
] as const;

describe('H5 catalog routes', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it.each(expectedViews)(
    'loads $componentName for $path',
    async ({ path, routeName, componentName }) => {
      const record = router
        .resolve(path)
        .matched.find((candidate) => candidate.name === routeName);
      const loader = record?.components?.default as LazyViewLoader | undefined;

      expect(typeof loader).toBe('function');
      expect((await loader?.())?.default.__name).toBe(componentName);
    },
  );
});
