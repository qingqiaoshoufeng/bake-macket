import {
  HomepageDraftStatus,
  type AdminCategoryView,
  type AdminHomepageView,
  type AdminProductSummaryView,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../../api/http.js';
import { loadAllCategories } from '../../categories/hooks/loadAllCategories.js';
import { loadAllProducts } from '../../products/hooks/loadAllProducts.js';
import { homepageApi } from '../api/index.js';
import { createHomepageDraft } from '../config/defaults.js';
import { useHomepageEditor } from './useHomepageEditor.js';

vi.mock('../api/index.js', () => ({
  homepageApi: {
    getOne: vi.fn(),
    saveDraft: vi.fn(),
    publish: vi.fn(),
  },
}));
vi.mock('../../categories/hooks/loadAllCategories.js', () => ({
  loadAllCategories: vi.fn(),
}));
vi.mock('../../products/hooks/loadAllProducts.js', () => ({
  loadAllProducts: vi.fn(),
}));

const api = vi.mocked(homepageApi);
const categoryLoader = vi.mocked(loadAllCategories);
const productLoader = vi.mocked(loadAllProducts);
const category: AdminCategoryView = {
  id: 'category-1',
  name: '蛋糕',
  sortOrder: 0,
  isActive: true,
};
const product: AdminProductSummaryView = {
  id: 'product-1',
  categoryId: category.id,
  categoryName: category.name,
  name: '草莓蛋糕',
  coverImage: null,
  sortOrder: 0,
  isActive: true,
  activeSkuCount: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  const resolve = vi.fn<(value: T) => void>();
  const reject = vi.fn<(reason: unknown) => void>();
  const promise = new Promise<T>((done, fail) => {
    resolve.mockImplementation(done);
    reject.mockImplementation(fail);
  });
  return { promise, resolve, reject };
}

function view(
  id: string,
  overrides: Partial<AdminHomepageView> = {},
): AdminHomepageView {
  return {
    id,
    pageKey: 'HOME',
    name: `草稿 ${id}`,
    status: HomepageDraftStatus.DRAFT,
    draftConfig: createHomepageDraft(),
    publishedConfig: null,
    version: 3,
    updatedAt: '2026-08-01T01:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    draftIssues: [],
    ...overrides,
  };
}

describe('useHomepageEditor', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('loads a specified draft and caches the static catalog across draft switches', async () => {
    api.getOne
      .mockResolvedValueOnce(view('12'))
      .mockResolvedValueOnce(view('13', { version: 8 }));
    categoryLoader.mockResolvedValue([category]);
    productLoader.mockResolvedValue([product]);
    const editor = useHomepageEditor();

    await editor.load('12');
    await editor.load('13');

    expect(api.getOne).toHaveBeenNthCalledWith(1, '12');
    expect(api.getOne).toHaveBeenNthCalledWith(2, '13');
    expect(categoryLoader).toHaveBeenCalledTimes(1);
    expect(productLoader).toHaveBeenCalledTimes(1);
    expect(editor.draftId.value).toBe('13');
    expect(editor.version.value).toBe(8);
    expect(editor.categories.value).toEqual([category]);
    expect(editor.products.value).toEqual([product]);
  });

  it('only lets the latest concurrent load update editor state and loading', async () => {
    const stale = deferred<AdminHomepageView>();
    const current = deferred<AdminHomepageView>();
    api.getOne
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    categoryLoader.mockResolvedValue([category]);
    productLoader.mockResolvedValue([product]);
    const editor = useHomepageEditor();

    const first = editor.load('12');
    const second = editor.load('13');
    current.resolve(
      view('13', {
        version: 8,
        draftConfig: {
          ...createHomepageDraft(),
          customerService: {
            ...createHomepageDraft().customerService,
            title: '当前配置',
          },
        },
      }),
    );
    await second;

    expect(editor.draftId.value).toBe('13');
    expect(editor.version.value).toBe(8);
    expect(editor.draft.value.customerService.title).toBe('当前配置');
    expect(editor.lastError.value).toBeNull();
    expect(editor.loading.value).toBe(false);

    stale.resolve(view('12', { version: 4 }));
    await first;

    expect(editor.draftId.value).toBe('13');
    expect(editor.version.value).toBe(8);
    expect(editor.draft.value.customerService.title).toBe('当前配置');
    expect(editor.lastError.value).toBeNull();
    expect(editor.loading.value).toBe(false);
    expect(categoryLoader).toHaveBeenCalledTimes(1);
    expect(productLoader).toHaveBeenCalledTimes(1);
    expect(editor.categories.value).toEqual([category]);
    expect(editor.products.value).toEqual([product]);
  });

  it('ignores stale load errors while the latest request remains loading', async () => {
    const stale = deferred<AdminHomepageView>();
    const current = deferred<AdminHomepageView>();
    api.getOne
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const editor = useHomepageEditor();

    const first = editor.load('12');
    const second = editor.load('13');
    stale.reject(new Error('旧请求失败'));
    await expect(first).rejects.toThrow('旧请求失败');

    expect(editor.lastError.value).toBeNull();
    expect(editor.loading.value).toBe(true);

    current.resolve(view('13', { version: 8 }));
    await second;

    expect(editor.draftId.value).toBe('13');
    expect(editor.version.value).toBe(8);
    expect(editor.lastError.value).toBeNull();
    expect(editor.loading.value).toBe(false);
  });

  it('saves and publishes the current ID and applies the returned view state', async () => {
    const initial = view('12');
    api.getOne.mockResolvedValue(initial);
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const editor = useHomepageEditor();
    await editor.load('12');
    const changed = {
      ...createHomepageDraft(),
      customerService: {
        ...createHomepageDraft().customerService,
        title: '新的客服标题',
      },
    };
    editor.replaceDraft(changed);
    const saved = view('12', {
      draftConfig: changed,
      version: 4,
      status: HomepageDraftStatus.PUBLISHED_WITH_CHANGES,
    });
    api.saveDraft.mockResolvedValue(saved);

    await editor.saveDraft();

    expect(api.saveDraft).toHaveBeenCalledWith('12', {
      config: changed,
      version: 3,
    });
    expect(editor.version.value).toBe(4);
    expect(editor.status.value).toBe(
      HomepageDraftStatus.PUBLISHED_WITH_CHANGES,
    );
    expect(editor.dirty.value).toBe(false);

    const published = view('12', {
      draftConfig: changed,
      version: 4,
      status: HomepageDraftStatus.PUBLISHED,
      publishedVersion: 9,
      publishedAt: '2026-08-01T02:00:00.000Z',
    });
    api.publish.mockResolvedValue(published);
    await editor.publish();

    expect(api.publish).toHaveBeenCalledWith('12', { version: 4 });
    expect(editor.status.value).toBe(HomepageDraftStatus.PUBLISHED);
    expect(editor.publishedVersion.value).toBe(9);
    expect(editor.publishedAt.value).toBe('2026-08-01T02:00:00.000Z');
  });

  it('keeps local config and conflict state after a 409 save response', async () => {
    api.getOne.mockResolvedValue(view('12'));
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const editor = useHomepageEditor();
    await editor.load('12');
    const changed = {
      ...createHomepageDraft(),
      imageBlocks: [],
    };
    editor.replaceDraft(changed);
    api.saveDraft.mockRejectedValue(
      new ApiClientError(409, '草稿已被其他管理员更新'),
    );

    await expect(editor.saveDraft()).rejects.toThrow('草稿已被其他管理员更新');

    expect(editor.draft.value).toEqual(changed);
    expect(editor.dirty.value).toBe(true);
    expect(editor.conflict.value).toBe('草稿已被其他管理员更新');
  });

  it('stores validation issues from 422 without replacing the local draft', async () => {
    api.getOne.mockResolvedValue(view('12'));
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const editor = useHomepageEditor();
    await editor.load('12');
    const issue = {
      code: 'HERO_REQUIRED',
      message: '请配置首屏轮播',
      sectionId: 'hero',
    };
    api.publish.mockRejectedValue(
      new ApiClientError(422, '首页草稿未通过发布校验', {
        details: { issues: [issue] },
      }),
    );

    await expect(editor.publish()).rejects.toThrow('首页草稿未通过发布校验');

    expect(editor.issues.value).toEqual([issue]);
    expect(editor.draftId.value).toBe('12');
    expect(editor.version.value).toBe(3);
  });
});
