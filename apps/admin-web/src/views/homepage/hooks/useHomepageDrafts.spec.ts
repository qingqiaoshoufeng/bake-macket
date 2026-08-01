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

function named(
  item: AdminHomepageDraftSummary,
  name: string,
): AdminHomepageDraftSummary {
  return { ...item, name };
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

  it('refreshes authoritative ordering after create and keeps the new draft selected', async () => {
    const initial = summary('1');
    const copied = summary('2');
    const blank = summary('3');
    api.list
      .mockResolvedValueOnce(list([initial]))
      .mockResolvedValueOnce(list([initial, copied]))
      .mockResolvedValueOnce(list([copied, initial, blank]));
    api.create
      .mockResolvedValueOnce(detail(copied))
      .mockResolvedValueOnce(detail(blank));
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    await drafts.create({ name: '复制方案', mode: 'COPY' });

    expect(api.create).toHaveBeenNthCalledWith(1, {
      name: '复制方案',
      mode: 'COPY',
      sourceDraftId: '1',
    });
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(drafts.items.value.map(({ id }) => id)).toEqual(['1', '2']);
    expect(drafts.activeId.value).toBe('2');

    await drafts.create({ name: '空白方案', mode: 'BLANK' });

    expect(api.create).toHaveBeenNthCalledWith(2, {
      name: '空白方案',
      mode: 'BLANK',
    });
    expect(api.list).toHaveBeenCalledTimes(3);
    expect(drafts.items.value.map(({ id }) => id)).toEqual(['2', '1', '3']);
    expect(drafts.activeId.value).toBe('3');
  });

  it('renames with the current version and applies the returned version to the list', async () => {
    const original = summary('1', HomepageDraftStatus.DRAFT, 3);
    const renamed = { ...original, name: '中秋首页', version: 4 };
    api.list
      .mockResolvedValueOnce(list([original]))
      .mockResolvedValueOnce(list([renamed]));
    api.rename.mockResolvedValue(detail(renamed));
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
    api.list
      .mockResolvedValueOnce(list([summary('1'), summary('2'), summary('3')]))
      .mockResolvedValueOnce(list([summary('1'), summary('3')]))
      .mockResolvedValueOnce(list([summary('1')]));
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

  it('keeps an authoritative remove result when an earlier refresh settles last', async () => {
    const first = summary('1');
    const removed = summary('2');
    const stale = deferred<AdminHomepageDraftListView>();
    api.list
      .mockResolvedValueOnce(list([first, removed]))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(list([first]));
    api.remove.mockResolvedValue(undefined);
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    const refresh = drafts.refresh();
    await drafts.remove('2');
    stale.resolve(list([first, removed]));
    await refresh;

    expect(drafts.items.value).toEqual([first]);
    expect(drafts.total.value).toBe(1);
    expect(drafts.loading.value).toBe(false);
    expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
  });

  it('keeps an authoritative rename result when an earlier refresh settles last', async () => {
    const original = summary('1', HomepageDraftStatus.DRAFT, 3);
    const renamed = named({ ...original, version: 4 }, '中秋首页');
    const stale = deferred<AdminHomepageDraftListView>();
    api.list
      .mockResolvedValueOnce(list([original]))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(list([renamed]));
    api.rename.mockResolvedValue(detail(renamed));
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    const refresh = drafts.refresh();
    await drafts.rename('1', '中秋首页');
    stale.resolve(list([original]));
    await refresh;

    expect(drafts.items.value).toEqual([renamed]);
    expect(drafts.loading.value).toBe(false);
  });

  it('keeps an authoritative publish result when an earlier refresh settles last', async () => {
    const previous = summary('1', HomepageDraftStatus.PUBLISHED);
    const target = summary('2', HomepageDraftStatus.DRAFT, 4);
    const published = { ...target, status: HomepageDraftStatus.PUBLISHED };
    const stale = deferred<AdminHomepageDraftListView>();
    api.list
      .mockResolvedValueOnce(list([previous, target], '1'))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(list([summary('1'), published], '2'));
    api.publish.mockResolvedValue(detail(published));
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    const refresh = drafts.refresh();
    await drafts.publish('2', { version: 4 });
    stale.resolve(list([previous, target], '1'));
    await refresh;

    expect(drafts.publishedDraftId.value).toBe('2');
    expect(drafts.items.value).toEqual([summary('1'), published]);
    expect(drafts.loading.value).toBe(false);
  });

  it('reloads the last valid page after deleting the only item on a later page', async () => {
    const onlyItem = summary('21');
    const previousPage = Array.from({ length: 20 }, (_, index) =>
      summary(String(index + 1)),
    );
    api.list
      .mockResolvedValueOnce({
        items: [onlyItem],
        total: 21,
        page: 2,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        items: previousPage,
        total: 20,
        page: 1,
        pageSize: 20,
      });
    api.remove.mockResolvedValue(undefined);
    const drafts = useHomepageDrafts();
    await drafts.refresh({ page: 2, pageSize: 20 });

    await drafts.remove('21');

    expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    expect(drafts.page.value).toBe(1);
    expect(drafts.total.value).toBe(20);
    expect(drafts.items.value).toEqual(previousPage);
    expect(drafts.activeId.value).toBe('1');
  });

  it('applies publish results to versions and published statuses', async () => {
    const previous = summary('1', HomepageDraftStatus.PUBLISHED);
    const target = summary('2', HomepageDraftStatus.DRAFT, 4);
    const published = {
      ...target,
      status: HomepageDraftStatus.PUBLISHED,
    };
    api.list
      .mockResolvedValueOnce(list([previous, target], '1'))
      .mockResolvedValueOnce(list([summary('1'), published], '2'));
    api.publish.mockResolvedValue(detail(published));
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

  it('refreshes authoritatively after a failed rename invalidates a pending refresh', async () => {
    const original = summary('1', HomepageDraftStatus.DRAFT, 3);
    const stale = deferred<AdminHomepageDraftListView>();
    const failure = new Error('重命名失败');
    api.list
      .mockResolvedValueOnce(list([original]))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(list([original]));
    api.rename.mockRejectedValue(failure);
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    const refresh = drafts.refresh();
    await expect(drafts.rename('1', '失败名称')).rejects.toBe(failure);
    stale.resolve(list([named(original, '过期名称')]));
    await refresh;

    expect(api.list).toHaveBeenCalledTimes(3);
    expect(drafts.items.value).toEqual([original]);
    expect(drafts.error.value).toBe('重命名失败');
    expect(drafts.loading.value).toBe(false);
  });

  it('refreshes authoritatively after a failed remove invalidates a pending refresh', async () => {
    const first = summary('1');
    const target = summary('2');
    const stale = deferred<AdminHomepageDraftListView>();
    const failure = new Error('删除失败');
    api.list
      .mockResolvedValueOnce(list([first, target]))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(list([first, target]));
    api.remove.mockRejectedValue(failure);
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    const refresh = drafts.refresh();
    await expect(drafts.remove('2')).rejects.toBe(failure);
    stale.resolve(list([first]));
    await refresh;

    expect(api.list).toHaveBeenCalledTimes(3);
    expect(drafts.items.value).toEqual([first, target]);
    expect(drafts.error.value).toBe('删除失败');
  });

  it('preserves a user selection changed while rename is pending', async () => {
    const target = summary('1', HomepageDraftStatus.DRAFT, 3);
    const selected = summary('2');
    const pending = deferred<AdminHomepageView>();
    api.list
      .mockResolvedValueOnce(list([target, selected]))
      .mockResolvedValueOnce(
        list([named({ ...target, version: 4 }, '新名称'), selected]),
      );
    api.rename.mockReturnValue(pending.promise);
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    const rename = drafts.rename('1', '新名称');
    drafts.select('2');
    pending.resolve(detail(named({ ...target, version: 4 }, '新名称')));
    await rename;

    expect(drafts.activeId.value).toBe('2');
  });

  it('preserves a user selection changed while the rename refresh is pending', async () => {
    const target = summary('1', HomepageDraftStatus.DRAFT, 3);
    const second = summary('2');
    const selected = summary('3');
    const refresh = deferred<AdminHomepageDraftListView>();
    api.list
      .mockResolvedValueOnce(list([target, second, selected]))
      .mockReturnValueOnce(refresh.promise);
    api.rename.mockResolvedValue(
      detail(named({ ...target, version: 4 }, '新名称')),
    );
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    const rename = drafts.rename('1', '新名称');
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    drafts.select('3');
    refresh.resolve(
      list([named({ ...target, version: 4 }, '新名称'), second, selected]),
    );
    await rename;

    expect(drafts.activeId.value).toBe('3');
  });

  it('preserves a user selection changed while publish is pending', async () => {
    const target = summary('1', HomepageDraftStatus.DRAFT, 3);
    const selected = summary('2');
    const published = {
      ...target,
      status: HomepageDraftStatus.PUBLISHED,
    };
    const pending = deferred<AdminHomepageView>();
    api.list
      .mockResolvedValueOnce(list([target, selected]))
      .mockResolvedValueOnce(list([published, selected], '1'));
    api.publish.mockReturnValue(pending.promise);
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    const publish = drafts.publish('1', { version: 3 });
    drafts.select('2');
    pending.resolve(detail(published));
    await publish;

    expect(drafts.activeId.value).toBe('2');
  });

  it('preserves a user selection changed while the publish refresh is pending', async () => {
    const target = summary('1', HomepageDraftStatus.DRAFT, 3);
    const second = summary('2');
    const selected = summary('3');
    const published = {
      ...target,
      status: HomepageDraftStatus.PUBLISHED,
    };
    const refresh = deferred<AdminHomepageDraftListView>();
    api.list
      .mockResolvedValueOnce(list([target, second, selected]))
      .mockReturnValueOnce(refresh.promise);
    api.publish.mockResolvedValue(detail(published));
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    const publish = drafts.publish('1', { version: 3 });
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    drafts.select('3');
    refresh.resolve(list([published, second, selected], '1'));
    await publish;

    expect(drafts.activeId.value).toBe('3');
  });

  it('keeps an optimistically created draft when the follow-up refresh fails', async () => {
    const initial = summary('1');
    const created = summary('2');
    const refreshFailure = new Error('列表刷新失败');
    api.list
      .mockResolvedValueOnce(list([initial]))
      .mockRejectedValueOnce(refreshFailure);
    api.create.mockResolvedValue(detail(created));
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    await expect(
      drafts.create({ name: '新方案', mode: 'BLANK' }),
    ).resolves.toMatchObject({ id: '2' });

    expect(drafts.items.value).toEqual([created, initial]);
    expect(drafts.total.value).toBe(2);
    expect(drafts.page.value).toBe(1);
    expect(drafts.activeId.value).toBe('2');
    expect(drafts.error.value).toBe('列表刷新失败');
  });

  it('keeps an optimistically removed draft absent when the follow-up refresh fails', async () => {
    const first = summary('1');
    const removed = summary('2');
    const refreshFailure = new Error('列表刷新失败');
    api.list
      .mockResolvedValueOnce(list([first, removed]))
      .mockRejectedValueOnce(refreshFailure);
    api.remove.mockResolvedValue(undefined);
    const drafts = useHomepageDrafts();
    await drafts.refresh();
    drafts.select('2');

    await expect(drafts.remove('2')).resolves.toBeUndefined();

    expect(drafts.items.value).toEqual([first]);
    expect(drafts.total.value).toBe(1);
    expect(drafts.page.value).toBe(1);
    expect(drafts.activeId.value).toBe('1');
    expect(drafts.error.value).toBe('列表刷新失败');
  });

  it('converges after a second mutation invalidates the first refresh and then fails', async () => {
    const original = summary('1', HomepageDraftStatus.DRAFT, 3);
    const renamed = named({ ...original, version: 4 }, '已保存名称');
    const staleRefresh = deferred<AdminHomepageDraftListView>();
    const secondFailure = new Error('第二次重命名失败');
    api.list
      .mockResolvedValueOnce(list([original]))
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce(list([renamed]));
    api.rename
      .mockResolvedValueOnce(detail(renamed))
      .mockRejectedValueOnce(secondFailure);
    const drafts = useHomepageDrafts();
    await drafts.refresh();

    const firstMutation = drafts.rename('1', '已保存名称');
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    await expect(drafts.rename('1', '失败名称')).rejects.toBe(secondFailure);
    staleRefresh.resolve(list([original]));
    await firstMutation;

    expect(api.list).toHaveBeenCalledTimes(3);
    expect(drafts.items.value).toEqual([renamed]);
    expect(drafts.error.value).toBe('第二次重命名失败');
    expect(drafts.loading.value).toBe(false);
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
