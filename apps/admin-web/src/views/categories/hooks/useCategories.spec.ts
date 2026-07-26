import {
  BooleanFilter,
  type AdminCategoryListResult,
} from '@bake-mall/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { categoriesApi } from '../api/index.js';
import { categoryListMock } from '../mock/list.mock.js';
import { useCategories } from './useCategories.js';

vi.mock('../api/index.js', () => ({
  categoriesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(categoriesApi);
const firstCategory = categoryListMock[0];
const lastCategory = categoryListMock[2];

const categoryResult = (
  items = [...categoryListMock],
  page = 1,
  pageSize = 20,
): AdminCategoryListResult => ({ items, total: items.length, page, pageSize });

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
};

function createDeferred<T>(): Deferred<T> {
  const resolve = vi.fn<(value: T | PromiseLike<T>) => void>();
  function registerResolve(
    promiseResolve: (value: T | PromiseLike<T>) => void,
  ): void {
    resolve.mockImplementation(promiseResolve);
  }

  return {
    promise: new Promise<T>(registerResolve),
    resolve,
  };
}

describe('useCategories', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.list.mockImplementation((query) =>
      Promise.resolve(
        categoryResult([...categoryListMock], query.page, query.pageSize),
      ),
    );
  });

  it('applies trimmed filters only on search and resets pagination consistently', async () => {
    const state = useCategories();
    await state.refresh();

    state.draftFilters.q = '  蛋糕  ';
    state.draftFilters.isActive = BooleanFilter.YES;
    state.draftFilters.hasImage = BooleanFilter.NO;
    await state.setPage(3);

    expect(api.list).toHaveBeenLastCalledWith({ page: 3, pageSize: 20 });

    await state.search();
    expect(api.list).toHaveBeenLastCalledWith({
      q: '蛋糕',
      isActive: BooleanFilter.YES,
      hasImage: BooleanFilter.NO,
      page: 1,
      pageSize: 20,
    });
    expect(state.advancedCount.value).toBe(1);

    await state.setPageSize(50);
    expect(api.list).toHaveBeenLastCalledWith({
      q: '蛋糕',
      isActive: BooleanFilter.YES,
      hasImage: BooleanFilter.NO,
      page: 1,
      pageSize: 50,
    });

    await state.reset();
    expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 });
    expect(state.advancedCount.value).toBe(0);
  });

  it('ignores an older response and preserves current rows on a failed query', async () => {
    const stale = createDeferred<AdminCategoryListResult>();
    const current = createDeferred<AdminCategoryListResult>();
    api.list
      .mockReset()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const state = useCategories();

    const firstLoad = state.refresh();
    const secondLoad = state.refresh();
    current.resolve(categoryResult([lastCategory], 2));
    await secondLoad;
    stale.resolve(categoryResult([firstCategory], 1));
    await firstLoad;

    expect(state.categories.value).toEqual([lastCategory]);
    expect(state.page.value).toBe(2);

    api.list.mockRejectedValueOnce(new Error('分类接口不可用'));
    await state.refresh();
    expect(state.categories.value).toEqual([lastCategory]);
    expect(state.lastError.value).toBe('分类接口不可用');
  });

  it('loads categories through the complete loading lifecycle', async () => {
    const listRequest = createDeferred<AdminCategoryListResult>();
    api.list.mockReturnValueOnce(listRequest.promise);
    const state = useCategories();

    expect(state.loading.value).toBe(false);
    const refreshPromise = state.refresh();
    expect(state.loading.value).toBe(true);

    listRequest.resolve(categoryResult());
    await refreshPromise;

    expect(state.loading.value).toBe(false);
    expect(state.lastError.value).toBeNull();
    expect(state.categories.value).toEqual(categoryListMock);
    expect(state.nextSortOrder()).toBe(3);
  });

  it('trims create input, omits an empty image, and refreshes', async () => {
    api.create.mockResolvedValueOnce(firstCategory);
    const state = useCategories();

    const created = await state.create({
      name: '  生日蛋糕  ',
      imageUrl: '   ',
      sortOrder: 4,
      isActive: true,
    });

    expect(api.create).toHaveBeenCalledWith({
      name: '生日蛋糕',
      sortOrder: 4,
      isActive: true,
    });
    expect(api.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(created).toEqual(firstCategory);
  });

  it('starts, saves, and closes inline editing with a trimmed payload', async () => {
    api.update.mockResolvedValueOnce(firstCategory);
    const state = useCategories();

    state.startEdit(firstCategory);
    state.editingDraft.name = '  节日蛋糕  ';
    state.editingDraft.imageUrl = ' https://cdn.example.com/holiday.png ';
    state.editingDraft.sortOrder = 5;
    state.editingDraft.isActive = false;
    await state.saveEdit(firstCategory);

    expect(api.update).toHaveBeenCalledWith(firstCategory.id, {
      name: '节日蛋糕',
      imageUrl: 'https://cdn.example.com/holiday.png',
      sortOrder: 5,
      isActive: false,
    });
    expect(state.editingId.value).toBeNull();
  });

  it('toggles and deletes rows before refreshing the applied query', async () => {
    api.update.mockResolvedValueOnce({ ...lastCategory, isActive: true });
    const state = useCategories();

    await state.toggleActive(lastCategory);
    expect(api.update).toHaveBeenCalledWith(lastCategory.id, {
      isActive: true,
    });

    await state.remove(firstCategory);
    expect(api.remove).toHaveBeenCalledWith(firstCategory.id);
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('rejects blank names before calling create or update', async () => {
    const state = useCategories();

    await expect(
      state.create({
        name: '   ',
        imageUrl: '',
        sortOrder: 0,
        isActive: true,
      }),
    ).rejects.toThrow('分类名称不能为空');

    state.startEdit(firstCategory);
    state.editingDraft.name = '   ';
    await expect(state.saveEdit(firstCategory)).rejects.toThrow(
      '分类名称不能为空',
    );

    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
  });
});
