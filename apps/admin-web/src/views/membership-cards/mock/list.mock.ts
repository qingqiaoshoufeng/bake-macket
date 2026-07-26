import {
  MembershipLevelStatus,
  MembershipTheme,
  type AdminMembershipLevelListItem,
} from '@bake-mall/contracts';

export const MEMBERSHIP_LEVEL_LIST_MOCK: readonly AdminMembershipLevelListItem[] =
  [
    {
      id: 'membership-level-pearl',
      code: 'PEARL_90',
      name: '珍珠季卡',
      subtitle: '轻轻尝鲜，也有会员好味道',
      rank: 10,
      priceCents: 9900,
      grantCreditCents: 12000,
      discountBasisPoints: 9800,
      validDays: 90,
      benefits: [{ title: '全场九八折', sortOrder: 0 }],
      cardTheme: { theme: MembershipTheme.PEARL, badgeText: 'FRESH BATCH' },
      sortOrder: 10,
      status: MembershipLevelStatus.INACTIVE,
      version: 1,
      purchaseCount: 0,
      createdAt: '2026-07-21T08:00:00.000Z',
      updatedAt: '2026-07-21T09:00:00.000Z',
    },
  ];
