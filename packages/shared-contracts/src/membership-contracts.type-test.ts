import {
  MembershipLevelStatus,
  MembershipTheme,
  type MembershipOverviewView,
  type SaveMembershipLevelRequest,
} from './index.js';

const validLevel: SaveMembershipLevelRequest = {
  code: 'GOLD',
  name: '鎏金会员',
  rank: 20,
  priceCents: 50_000,
  grantCreditCents: 60_000,
  discountBasisPoints: 9_500,
  validDays: 365,
  benefits: [{ title: '全场九五折', sortOrder: 10 }],
  cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'GOLD MEMBER' },
  sortOrder: 20,
  status: MembershipLevelStatus.ACTIVE,
};

const validOverview: MembershipOverviewView = {
  currentMembership: null,
  account: { availableCreditCents: 0, version: 1 },
  levels: [],
  simulatedPaymentEnabled: false,
};

const invalidTheme: SaveMembershipLevelRequest = {
  ...validLevel,
  cardTheme: {
    // @ts-expect-error theme must use MembershipTheme.
    theme: 'RAINBOW',
    badgeText: 'INVALID',
  },
};

void [validLevel, validOverview, invalidTheme];
