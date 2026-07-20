import {
  MembershipLevelStatus,
  MembershipTheme,
  type AdminMembershipLevelListQuery,
  type SaveMembershipLevelRequest,
} from '@bake-mall/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../../../api/http.js';
import { membershipCardsApi } from './index.js';

vi.mock('../../../api/http.js', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const client = vi.mocked(apiClient);
const query: AdminMembershipLevelListQuery = {
  q: 'GOLD',
  status: MembershipLevelStatus.ACTIVE,
};
const body: SaveMembershipLevelRequest = {
  code: 'GOLD',
  name: '鎏金卡',
  subtitle: '每一口都更从容',
  description: '全年会员权益',
  rank: 2,
  priceCents: 19900,
  grantCreditCents: 30000,
  discountBasisPoints: 8800,
  validDays: 365,
  benefits: [{ title: '会员折扣', sortOrder: 0 }],
  cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'GOLD' },
  sortOrder: 20,
  status: MembershipLevelStatus.ACTIVE,
  version: 3,
};

describe('membershipCardsApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('composes membership level endpoints without reshaping payloads', async () => {
    await membershipCardsApi.list(query);
    await membershipCardsApi.getOne('level-1');
    await membershipCardsApi.create(body);
    await membershipCardsApi.update('level-1', body);
    await membershipCardsApi.updateStatus(
      'level-1',
      MembershipLevelStatus.INACTIVE,
      3,
    );
    await membershipCardsApi.remove('level-1');

    expect(client.get).toHaveBeenNthCalledWith(
      1,
      '/admin/membership-levels?q=GOLD&status=ACTIVE',
    );
    expect(client.get).toHaveBeenNthCalledWith(
      2,
      '/admin/membership-levels/level-1',
    );
    expect(client.post).toHaveBeenCalledWith('/admin/membership-levels', body);
    expect(client.put).toHaveBeenCalledWith(
      '/admin/membership-levels/level-1',
      body,
    );
    expect(client.patch).toHaveBeenCalledWith(
      '/admin/membership-levels/level-1/status',
      { status: MembershipLevelStatus.INACTIVE, version: 3 },
    );
    expect(client.delete).toHaveBeenCalledWith(
      '/admin/membership-levels/level-1',
    );
  });
});
