import { describe, expect, it } from 'vitest';

import CategoriesView from '../views/CategoriesView.vue';
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
