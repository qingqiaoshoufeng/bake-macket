import {
  MembershipLevelStatus,
  MembershipTheme,
  type AdminMembershipLevelListItem,
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

describe('useMembershipCards', () => {
  afterEach(() => vi.resetAllMocks());

  it('按搜索和状态筛选加载生产 API', async () => {
    api.list.mockResolvedValue([level]);
    const cards = useMembershipCards();
    cards.setFilters({ q: ' PEARL ', status: MembershipLevelStatus.INACTIVE });

    await cards.refresh();

    expect(api.list).toHaveBeenCalledWith({
      q: 'PEARL',
      status: MembershipLevelStatus.INACTIVE,
    });
    expect(cards.levels.value).toEqual([level]);
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
