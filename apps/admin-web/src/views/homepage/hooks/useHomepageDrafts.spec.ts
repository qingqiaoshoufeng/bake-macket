import {
  HomepageDraftStatus,
  type AdminHomepageDraftListView,
  type AdminHomepageDraftSummary,
  type AdminHomepageView,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { homepageApi } from '../api/index.js';
import { createHomepageDraft } from '../config/defaults.js';
import { useHomepageDrafts } from './useHomepageDrafts.js';

vi.mock('../api/index.js', () => ({
  homepageApi: {
    list: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    publish: vi.fn(),
  },
}));

const api = vi.mocked(homepageApi);
const timestamps = {
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
};

function summary(
  id: string,
  status: AdminHomepageDraftSummary['status'] = HomepageDraftStatus.DRAFT,
  version = 1,
): AdminHomepageDraftSummary {
  return { id, name: `草稿 ${id}`, status, version, ...timestamps };
}

function list(
  items: readonly AdminHomepageDraftSummary[],
  publishedDraftId?: string,
): AdminHomepageDraftListView {
  return {
    items: [...items],
    total: items.length,
    page: 1,
    pageSize: 20,
    ...(publishedDraftId ? { publishedDraftId } : {}),
  };
}

function detail(item: AdminHomepageDraftSummary): AdminHomepageView {
  return {
    id: item.id,
    pageKey: 'HOME',
    name: item.name,
    status: item.status,
    draftConfig: createHomepageDraft(),
    publishedConfig: null,
    version: item.version,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    draftIssues: [],
  };
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  const resolve = vi.fn<(value: T) => void>();
  const promise = new Promise<T>((done) => resolve.mockImplementation(done));
  return { promise, resolve };
}

describe('useHomepageDrafts', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    HomepageDraftStatus.PUBLISHED,
    HomepageDraftStatus.PUBLISHED_WITH_CHANGES,
  ])(
    'selects the published source on first load when its status is %s',
    async (status) => {
      api.list.mockResolvedValue(
        list([summary('1'), summary('2', status)], '2'),
      );
      const drafts = useHomepageDrafts();

      await drafts.refresh();

      expect(api.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
      expect(drafts.activeId.value).toBe('2');
      expect(drafts.items.value).toHaveLength(2);
    },
  );

  it('selects the first row when the list has no published source', async () => {
    api.list.mockResolvedValue(list([summary('1'), summary('2')]));
    const drafts = useHomepageDrafts();

    await drafts.refresh();

    expect(drafts.activeId.value).toBe('1');
  });

  it('creates COPY from the active draft and BLANK without a source, then selects immutable inserted rows', async () => {
    api.list.mockResolvedValue(list([summary('1')]));
    const copied = summary('2');
    const blank = summary('3');
    api.create
      .mockResolvedValueOnce(detail(copied))
      .mockResolvedValueOnce(detail(blank));
    const drafts = useHomepageDrafts();
    await drafts.refresh();
    const originalItems = drafts.items.value;

    await drafts.create({ name: '复制方案', mode: 'COPY' });

    expect(api.create).toHaveBeenNthCalledWith(1, {
      name: '复制方案',
      mode: 'COPY',
      sourceDraftId: '1',
    });
    expect(drafts.activeId.value).toBe('2');
    expect(drafts.items.value).not.toBe(originalItems);
    expect(drafts.items.value.map(({ id }) => id)).toEqual(['2', '1']);

    await drafts.create({ name: '空白方案', mode: 'BLANK' });

    expect(api.create).toHaveBeenNthCalledWith(2, {
      name: '空白方案',
      mode: 'BLANK',
    });
    expect(drafts.activeId.value).toBe('3');
  });

  it('renames with the current version and applies the returned version to the list', async () => {
    const original = summary('1', HomepageDraftStatus.DRAFT, 3);
    api.list.mockResolvedValue(list([original]));
    api.rename.mockResolvedValue(
      detail({ ...original, name: '中秋首页', version: 4 }),
    );
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    await drafts.rename('1', '中秋首页');

    expect(api.rename).toHaveBeenCalledWith('1', {
      name: '中秋首页',
      version: 3,
    });
    expect(drafts.items.value[0]).toMatchObject({
      id: '1',
      name: '中秋首页',
      version: 4,
    });
  });

  it('prevents deleting the published source and preserves normal rows on API failure', async () => {
    const published = summary('1', HomepageDraftStatus.PUBLISHED);
    const ordinary = summary('2');
    api.list.mockResolvedValue(list([published, ordinary], '1'));
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    await expect(drafts.remove('1')).rejects.toThrow(
      '当前线上来源草稿不能删除',
    );
    expect(api.remove).not.toHaveBeenCalled();

    const failure = new Error('删除失败');
    api.remove.mockRejectedValueOnce(failure);
    await expect(drafts.remove('2')).rejects.toBe(failure);
    expect(drafts.items.value).toEqual([published, ordinary]);
    expect(drafts.error.value).toBe('删除失败');
  });

  it('selects the next row, then the previous row, after deleting an ordinary draft', async () => {
    api.list.mockResolvedValue(
      list([summary('1'), summary('2'), summary('3')]),
    );
    api.remove.mockResolvedValue(undefined);
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    drafts.select('2');
    await drafts.remove('2');
    expect(drafts.activeId.value).toBe('3');

    await drafts.remove('3');
    expect(drafts.activeId.value).toBe('1');
    expect(drafts.items.value.map(({ id }) => id)).toEqual(['1']);
  });

  it('applies publish results to versions and published statuses', async () => {
    const previous = summary('1', HomepageDraftStatus.PUBLISHED);
    const target = summary('2', HomepageDraftStatus.DRAFT, 4);
    api.list.mockResolvedValue(list([previous, target], '1'));
    api.publish.mockResolvedValue(
      detail({ ...target, status: HomepageDraftStatus.PUBLISHED }),
    );
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    await drafts.publish('2', { version: 4 });

    expect(api.publish).toHaveBeenCalledWith('2', { version: 4 });
    expect(drafts.publishedDraftId.value).toBe('2');
    expect(drafts.items.value).toEqual([
      expect.objectContaining({ id: '1', status: HomepageDraftStatus.DRAFT }),
      expect.objectContaining({
        id: '2',
        status: HomepageDraftStatus.PUBLISHED,
      }),
    ]);
  });

  it('ignores stale list responses and keeps loading until the newest request settles', async () => {
    const stale = deferred<AdminHomepageDraftListView>();
    const current = deferred<AdminHomepageDraftListView>();
    api.list
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const drafts = useHomepageDrafts();

    const first = drafts.refresh();
    const second = drafts.refresh({ page: 2, pageSize: 10 });
    stale.resolve(list([summary('stale')]));
    await first;
    expect(drafts.loading.value).toBe(true);

    current.resolve({ ...list([summary('current')]), page: 2, pageSize: 10 });
    await second;

    expect(drafts.items.value.map(({ id }) => id)).toEqual(['current']);
    expect(drafts.page.value).toBe(2);
    expect(drafts.pageSize.value).toBe(10);
    expect(drafts.loading.value).toBe(false);
  });
});
