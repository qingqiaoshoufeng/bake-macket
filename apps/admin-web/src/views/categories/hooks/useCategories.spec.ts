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
    api.list.mockResolvedValue([...categoryListMock]);
  });

  it('loads categories through the complete loading lifecycle', async () => {
    const listRequest =
      createDeferred<Awaited<ReturnType<typeof categoriesApi.list>>>();
    api.list.mockReturnValueOnce(listRequest.promise);
    const state = useCategories();

    expect(state.loading.value).toBe(false);

    const refreshPromise = state.refresh();

    expect(state.loading.value).toBe(true);
    listRequest.resolve([...categoryListMock]);
    await refreshPromise;

    expect(state.loading.value).toBe(false);
    expect(state.lastError.value).toBeNull();
    expect(state.categories.value).toEqual(categoryListMock);
    expect(state.nextSortOrder()).toBe(3);
    expect(state.blankForm()).toEqual({
      name: '',
      imageUrl: '',
      sortOrder: 3,
      isActive: true,
    });
  });

  it('captures a list failure and always clears loading', async () => {
    api.list.mockRejectedValueOnce(new Error('分类接口不可用'));
    const state = useCategories();

    await state.refresh();

    expect(state.loading.value).toBe(false);
    expect(state.categories.value).toEqual([]);
    expect(state.lastError.value).toBe('分类接口不可用');
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
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(created).toEqual(firstCategory);
  });

  it('starts, saves, and closes inline editing with a trimmed payload', async () => {
    api.update.mockResolvedValueOnce(firstCategory);
    const state = useCategories();

    state.startEdit(firstCategory);

    expect(state.editingId.value).toBe(firstCategory.id);
    expect(state.editingDraft).toEqual({
      name: firstCategory.name,
      imageUrl: firstCategory.imageUrl ?? '',
      sortOrder: firstCategory.sortOrder,
      isActive: firstCategory.isActive,
    });

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
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('toggles active state and waits for its refresh', async () => {
    const listRequest =
      createDeferred<Awaited<ReturnType<typeof categoriesApi.list>>>();
    api.update.mockResolvedValueOnce({ ...lastCategory, isActive: true });
    api.list.mockReturnValueOnce(listRequest.promise);
    const state = useCategories();
    const settled = vi.fn();

    const togglePromise = state.toggleActive(lastCategory).then(settled);
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    expect(api.update).toHaveBeenCalledWith(lastCategory.id, {
      isActive: true,
    });
    expect(settled).not.toHaveBeenCalled();

    listRequest.resolve([...categoryListMock]);
    await togglePromise;

    expect(settled).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('deletes by id and waits for its refresh', async () => {
    const listRequest =
      createDeferred<Awaited<ReturnType<typeof categoriesApi.list>>>();
    api.list.mockReturnValueOnce(listRequest.promise);
    const state = useCategories();
    const settled = vi.fn();

    const removePromise = state.remove(firstCategory).then(settled);
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    expect(api.remove).toHaveBeenCalledWith(firstCategory.id);
    expect(settled).not.toHaveBeenCalled();

    listRequest.resolve([...categoryListMock]);
    await removePromise;

    expect(settled).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledTimes(1);
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
