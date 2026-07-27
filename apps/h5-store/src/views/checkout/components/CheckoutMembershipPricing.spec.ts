import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  MembershipStatus,
  MembershipTheme,
  type OrderQuoteView,
} from '@bake-mall/contracts';

import CheckoutMembershipPricing from './CheckoutMembershipPricing.vue';

const quote: OrderQuoteView = {
  lines: [],
  goodsTotalCents: 6800,
  membershipDiscountCents: 680,
  discountedTotalCents: 6120,
  availableCreditCents: 3000,
  maxCreditCents: 3000,
  requestedCreditCents: 2000,
  creditAppliedCents: 2000,
  payableTotalCents: 4120,
  membership: {
    id: 'membership-1',
    levelId: 'level-1',
    code: 'GOLD',
    name: '金卡',
    rank: 2,
    discountBasisPoints: 9000,
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2027-07-01T00:00:00.000Z',
    status: MembershipStatus.ACTIVE,
    cardTheme: {
      theme: MembershipTheme.CHAMPAGNE,
      badgeText: '金卡会员',
    },
    benefits: [{ title: '全场九折', sortOrder: 0 }],
  },
  quoteToken: 'quote-token',
  expiresAt: '2099-07-26T12:05:00.000Z',
};

describe('CheckoutMembershipPricing', () => {
  it('renders authoritative membership, discount, credit cap, and payable amounts', () => {
    const wrapper = mount(CheckoutMembershipPricing, {
      props: {
        quote,
        creditText: '20.00',
        loading: false,
        validationError: null,
        quoteError: null,
        requiresConfirmation: false,
      },
    });

    expect(wrapper.text()).toContain('金卡');
    expect(wrapper.text()).toContain('9 折');
    expect(wrapper.text()).toContain('¥68.00');
    expect(wrapper.text()).toContain('-¥6.80');
    expect(wrapper.text()).toContain('最多可抵扣 ¥30.00');
    expect(wrapper.text()).toContain('-¥20.00');
    expect(wrapper.text()).toContain('¥41.20');
    expect(
      wrapper.get('[data-testid="credit-input"]').attributes('inputmode'),
    ).toBe('decimal');
  });

  it('provides a 44px confirmation control after stale refresh', async () => {
    const wrapper = mount(CheckoutMembershipPricing, {
      props: {
        quote,
        creditText: '20.00',
        loading: false,
        validationError: null,
        quoteError: '报价已更新，请再次确认',
        requiresConfirmation: true,
      },
    });

    const confirm = wrapper.get('[data-testid="confirm-quote"]');
    expect(confirm.attributes('type')).toBe('button');
    await confirm.trigger('click');
    expect(wrapper.emitted('confirm')).toEqual([[]]);
  });
});
