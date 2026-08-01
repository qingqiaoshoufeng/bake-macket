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
    await expect(first).resolves.toBeUndefined();

    expect(editor.lastError.value).toBeNull();
    expect(editor.loading.value).toBe(true);

    current.resolve(view('13', { version: 8 }));
    await second;

    expect(editor.draftId.value).toBe('13');
    expect(editor.version.value).toBe(8);
    expect(editor.lastError.value).toBeNull();
    expect(editor.loading.value).toBe(false);
  });

  it('does not apply a stale save after another draft finishes loading', async () => {
    api.getOne
      .mockResolvedValueOnce(view('12'))
      .mockResolvedValueOnce(view('13', { version: 8 }));
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const pendingSave = deferred<AdminHomepageView>();
    api.saveDraft.mockReturnValue(pendingSave.promise);
    const editor = useHomepageEditor();
    await editor.load('12');
    editor.replaceDraft({
      ...createHomepageDraft(),
      imageBlocks: [],
    });

    const save = editor.saveDraft();
    await editor.load('13');
    pendingSave.resolve(
      view('12', {
        version: 4,
        draftIssues: [
          {
            code: 'STALE_SAVE',
            message: '旧保存结果',
            sectionId: 'hero',
          },
        ],
      }),
    );
    await expect(save).resolves.toMatchObject({ id: '12', version: 4 });

    expect(editor.draftId.value).toBe('13');
    expect(editor.version.value).toBe(8);
    expect(editor.issues.value).toEqual([]);
    expect(editor.conflict.value).toBeNull();
    expect(editor.lastError.value).toBeNull();
    expect(editor.saving.value).toBe(false);
  });

  it('swallows a stale save error after another draft finishes loading', async () => {
    api.getOne
      .mockResolvedValueOnce(view('12'))
      .mockResolvedValueOnce(view('13', { version: 8 }));
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const pendingSave = deferred<AdminHomepageView>();
    api.saveDraft.mockReturnValue(pendingSave.promise);
    const editor = useHomepageEditor();
    await editor.load('12');

    const save = editor.saveDraft();
    await editor.load('13');
    pendingSave.reject(new ApiClientError(409, '旧草稿冲突'));
    await expect(save).resolves.toBeUndefined();

    expect(editor.draftId.value).toBe('13');
    expect(editor.version.value).toBe(8);
    expect(editor.conflict.value).toBeNull();
    expect(editor.lastError.value).toBeNull();
  });

  it('does not let an old load overwrite newer edits to the current draft', async () => {
    const oldLoad = deferred<AdminHomepageView>();
    api.getOne
      .mockResolvedValueOnce(view('12'))
      .mockReturnValueOnce(oldLoad.promise);
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const editor = useHomepageEditor();
    await editor.load('12');
    const changed = {
      ...createHomepageDraft(),
      customerService: {
        ...createHomepageDraft().customerService,
        title: '加载期间编辑的配置',
      },
    };

    const load = editor.load('12');
    editor.replaceDraft(changed);
    oldLoad.resolve(view('12', { version: 2 }));
    await load;

    expect(editor.draftId.value).toBe('12');
    expect(editor.version.value).toBe(3);
    expect(editor.draft.value).toEqual(changed);
    expect(editor.dirty.value).toBe(true);
    expect(editor.lastError.value).toBeNull();
    expect(editor.loading.value).toBe(false);
  });

  it('keeps the latest save flag active when an older save settles first', async () => {
    api.getOne.mockResolvedValue(view('12'));
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const stale = deferred<AdminHomepageView>();
    const current = deferred<AdminHomepageView>();
    api.saveDraft
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const editor = useHomepageEditor();
    await editor.load('12');

    const first = editor.saveDraft();
    const second = editor.saveDraft();
    stale.resolve(view('12', { version: 4 }));
    await first;
    expect(editor.saving.value).toBe(true);

    current.resolve(view('12', { version: 5 }));
    await second;

    expect(editor.version.value).toBe(5);
    expect(editor.saving.value).toBe(false);
  });

  it('does not apply a pending save after the user edits again', async () => {
    api.getOne.mockResolvedValue(view('12'));
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const pendingSave = deferred<AdminHomepageView>();
    api.saveDraft.mockReturnValue(pendingSave.promise);
    const editor = useHomepageEditor();
    await editor.load('12');
    const savedConfig = {
      ...createHomepageDraft(),
      customerService: {
        ...createHomepageDraft().customerService,
        title: '发起保存时的内容',
      },
    };
    const latestConfig = {
      ...savedConfig,
      customerService: {
        ...savedConfig.customerService,
        title: '保存期间继续编辑',
      },
    };

    editor.replaceDraft(savedConfig);
    const save = editor.saveDraft();
    editor.replaceDraft(latestConfig);
    expect(editor.saving.value).toBe(true);
    pendingSave.resolve(view('12', { version: 4, draftConfig: savedConfig }));
    await save;

    expect(editor.draft.value).toEqual(latestConfig);
    expect(editor.version.value).toBe(3);
    expect(editor.dirty.value).toBe(true);
    expect(editor.saving.value).toBe(false);
  });

  it('does not apply a pending publish after the user edits again', async () => {
    api.getOne.mockResolvedValue(view('12'));
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const pendingPublish = deferred<AdminHomepageView>();
    api.publish.mockReturnValue(pendingPublish.promise);
    const editor = useHomepageEditor();
    await editor.load('12');
    const latestConfig = {
      ...createHomepageDraft(),
      customerService: {
        ...createHomepageDraft().customerService,
        title: '发布期间继续编辑',
      },
    };

    const publish = editor.publish();
    editor.replaceDraft(latestConfig);
    expect(editor.publishing.value).toBe(true);
    pendingPublish.resolve(
      view('12', {
        status: HomepageDraftStatus.PUBLISHED,
        publishedVersion: 8,
      }),
    );
    await publish;

    expect(editor.draft.value).toEqual(latestConfig);
    expect(editor.status.value).toBe(HomepageDraftStatus.DRAFT);
    expect(editor.publishedVersion.value).toBeUndefined();
    expect(editor.dirty.value).toBe(true);
    expect(editor.publishing.value).toBe(false);
  });

  it('blocks save and publish while another draft is loading', async () => {
    api.getOne.mockResolvedValueOnce(view('12'));
    categoryLoader.mockResolvedValue([]);
    productLoader.mockResolvedValue([]);
    const pendingLoad = deferred<AdminHomepageView>();
    api.getOne.mockReturnValueOnce(pendingLoad.promise);
    const editor = useHomepageEditor();
    await editor.load('12');

    const load = editor.load('13');

    expect(editor.loading.value).toBe(true);
    expect(editor.canPublish.value).toBe(false);
    await expect(editor.saveDraft()).rejects.toThrow('草稿加载中');
    await expect(editor.publish()).rejects.toThrow('草稿加载中');
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(api.publish).not.toHaveBeenCalled();
    expect(editor.loading.value).toBe(true);

    pendingLoad.resolve(view('13', { version: 8 }));
    await load;

    expect(editor.draftId.value).toBe('13');
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
