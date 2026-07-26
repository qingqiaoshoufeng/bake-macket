import { MembershipLevelStatus, MembershipTheme } from '@bake-mall/contracts';

import type {
  MembershipCardFilters,
  MembershipCardForm,
} from '../type/index.js';

export function createMembershipCardDefaults(): MembershipCardForm {
  return {
    code: '',
    name: '',
    subtitle: '',
    description: '',
    rank: 1,
    priceYuan: '0.00',
    grantCreditYuan: '0.00',
    discountText: '10.0',
    validDays: 365,
    benefits: [],
    theme: MembershipTheme.PEARL,
    badgeText: '',
    sortOrder: 0,
    status: MembershipLevelStatus.INACTIVE,
  };
}

export const DEFAULT_MEMBERSHIP_CARD_FILTERS: MembershipCardFilters = {
  q: '',
  status: '',
};
