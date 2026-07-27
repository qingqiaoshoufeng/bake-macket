import {
  BooleanFilter,
  MembershipLevelStatus,
  MembershipTheme,
  type AdminMembershipLevelListItem,
  type AdminMembershipLevelListResult,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { membershipCardsApi } from '../api/index.js';
import { useMembershipCards } from './useMembershipCards.js';

vi.mock('../api/index.js', () => ({
  membershipCardsApi: {
    list: vi.fn(),
    updateStatus: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(membershipCardsApi);
const level: AdminMembershipLevelListItem = {
  id: 'level-1',
  code: 'PEARL',
  name: '珍珠卡',
  rank: 10,
  priceCents: 9900,
  grantCreditCents: 10000,
  discountBasisPoints: 9800,
  validDays: 90,
  benefits: [],
  cardTheme: { theme: MembershipTheme.PEARL, badgeText: 'STARTER' },
  sortOrder: 2,
  status: MembershipLevelStatus.INACTIVE,
  version: 1,
  purchaseCount: 0,
  createdAt: '2026-07-21T08:00:00.000Z',
  updatedAt: '2026-07-21T09:00:00.000Z',
};

function paginated(
  items: readonly AdminMembershipLevelListItem[],
  page = 1,
): AdminMembershipLevelListResult {
  return { items: [...items], total: items.length, page, pageSize: 20 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('useMembershipCards', () => {
  afterEach(() => vi.resetAllMocks());

  it('将基础和高级草稿条件精确映射为分页查询', async () => {
    api.list.mockResolvedValueOnce(paginated([level]));
    const cards = useMembershipCards();
    cards.setFilters({
      q: ' PEARL ',
      status: MembershipLevelStatus.INACTIVE,
      rank: 10,
      minPriceYuan: '0.29',
      maxPriceYuan: '99.90',
      minDiscountText: '8.8',
      maxDiscountText: '9.8',
      hasPurchases: BooleanFilter.YES,
      theme: MembershipTheme.PEARL,
      minValidDays: 30,
      maxValidDays: 365,
      updatedAtRange: [
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-08-01T00:00:00.000Z'),
      ],
    });

    await cards.search();

    expect(api.list).toHaveBeenCalledWith({
      q: 'PEARL',
      status: MembershipLevelStatus.INACTIVE,
      rank: 10,
      minPriceCents: 29,
      maxPriceCents: 9990,
      minDiscountBasisPoints: 8800,
      maxDiscountBasisPoints: 9800,
      hasPurchases: BooleanFilter.YES,
      theme: MembershipTheme.PEARL,
      minValidDays: 30,
      maxValidDays: 365,
      updatedAtFrom: '2026-07-01T00:00:00.000Z',
      updatedAtBefore: '2026-08-01T00:00:00.000Z',
      page: 1,
      pageSize: 20,
    });
    expect(cards.levels.value).toEqual([level]);
    expect(cards.total.value).toBe(1);
  });

  it('分页只使用已应用条件，搜索和重置都会回到第一页', async () => {
    api.list.mockResolvedValue(paginated([], 1));
    const cards = useMembershipCards();
    cards.setFilters({ q: '已应用' });
    await cards.search();
    cards.setFilters({ q: '仅草稿' });

    await cards.setPage(2);

    expect(api.list).toHaveBeenLastCalledWith({
      q: '已应用',
      page: 2,
      pageSize: 20,
    });

    await cards.reset();

    expect(cards.filters.q).toBe('');
    expect(cards.page.value).toBe(1);
    expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
  });

  it('pageSize 变化回到第一页且旧请求不能覆盖最新结果', async () => {
    const oldRequest = deferred<AdminMembershipLevelListResult>();
    const newRequest = deferred<AdminMembershipLevelListResult>();
    api.list
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const cards = useMembershipCards();

    const oldLoad = cards.setPage(2);
    const newLoad = cards.setPageSize(50);
    newRequest.resolve({
      items: [{ ...level, id: 'new-level' }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    await newLoad;
    oldRequest.reject(new Error('旧请求失败'));
    await oldLoad;

    expect(cards.levels.value.map(({ id }) => id)).toEqual(['new-level']);
    expect(cards.page.value).toBe(1);
    expect(cards.pageSize.value).toBe(50);
    expect(cards.loadError.value).toBeNull();
    expect(cards.loading.value).toBe(false);
  });

  it('金额草稿非法时保留草稿、阻止新请求并使旧响应失效', async () => {
    const oldRequest = deferred<AdminMembershipLevelListResult>();
    api.list.mockReturnValueOnce(oldRequest.promise);
    const cards = useMembershipCards();
    const oldLoad = cards.refresh();
    cards.setFilters({ minPriceYuan: '0.001' });

    await cards.search();
    oldRequest.resolve(paginated([level]));
    await oldLoad;

    expect(api.list).toHaveBeenCalledTimes(1);
    expect(cards.filters.minPriceYuan).toBe('0.001');
    expect(cards.loadError.value).toBeInstanceOf(Error);
    expect(cards.levels.value).toEqual([]);
    expect(cards.loading.value).toBe(false);
  });

  it('使用共享状态与最新 version 上架或下架', async () => {
    const active = {
      ...level,
      status: MembershipLevelStatus.ACTIVE,
      version: 2,
    };
    api.updateStatus.mockResolvedValue(active);
    const cards = useMembershipCards();
    cards.levels.value = [level];

    await cards.toggleStatus(level);

    expect(api.updateStatus).toHaveBeenCalledWith(
      level.id,
      MembershipLevelStatus.ACTIVE,
      1,
    );
    expect(cards.levels.value).toEqual([active]);
  });

  it('只允许未售下架草稿发起删除，并保留 API 错误', async () => {
    const cards = useMembershipCards();
    cards.levels.value = [level];
    api.remove.mockRejectedValueOnce(new Error('删除失败'));

    await expect(cards.remove(level)).rejects.toThrow('删除失败');
    expect(cards.actionError.value).toBeInstanceOf(Error);
    expect(cards.levels.value).toEqual([level]);

    await expect(cards.remove({ ...level, purchaseCount: 1 })).rejects.toThrow(
      '只有未售下架草稿可以删除',
    );
    expect(api.remove).toHaveBeenCalledTimes(1);
  });
});
