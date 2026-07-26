import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  MembershipStatus,
  MembershipTheme,
  type MembershipOverviewView,
} from '@bake-mall/contracts';
import { Swipe, SwipeItem } from 'vant';

import MembershipCardCarousel from './MembershipCardCarousel.vue';

const overview: MembershipOverviewView = {
  currentMembership: {
    id: 'membership-2',
    levelId: 'level-2',
    code: 'BLOOM',
    name: '花漾卡',
    rank: 2,
    discountBasisPoints: 9000,
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2027-07-01T00:00:00.000Z',
    status: MembershipStatus.ACTIVE,
    cardTheme: { theme: MembershipTheme.JADE, badgeText: '常伴' },
    benefits: [],
  },
  account: { availableCreditCents: 3000, version: 1 },
  simulatedPaymentEnabled: true,
  levels: [
    {
      id: 'level-1',
      code: 'SEED',
      name: '麦芽卡',
      rank: 1,
      priceCents: 9900,
      grantCreditCents: 1000,
      discountBasisPoints: 9500,
      validDays: 365,
      benefits: [],
      cardTheme: { theme: MembershipTheme.PEARL, badgeText: '初见' },
      sortOrder: 1,
    },
    {
      id: 'level-2',
      code: 'BLOOM',
      name: '花漾卡',
      rank: 2,
      priceCents: 19900,
      grantCreditCents: 3000,
      discountBasisPoints: 9000,
      validDays: 365,
      benefits: [],
      cardTheme: { theme: MembershipTheme.JADE, badgeText: '常伴' },
      sortOrder: 2,
    },
    {
      id: 'level-3',
      code: 'HARVEST',
      name: '丰穗卡',
      rank: 3,
      priceCents: 29900,
      grantCreditCents: 5000,
      discountBasisPoints: 8500,
      validDays: 365,
      benefits: [],
      cardTheme: { theme: MembershipTheme.OBSIDIAN, badgeText: '珍藏' },
      sortOrder: 3,
    },
  ],
};

describe('MembershipCardCarousel', () => {
  it('uses Vant Swipe in manual mode and starts from the current card', () => {
    const wrapper = mount(MembershipCardCarousel, {
      props: { overview },
      global: { components: { VanSwipe: Swipe, VanSwipeItem: SwipeItem } },
    });
    const swipe = wrapper.getComponent(Swipe);

    expect(swipe.props('autoplay')).toBe(0);
    expect(swipe.props('initialSwipe')).toBe(0);
    expect(wrapper.text()).toContain('续费');
    expect(wrapper.text()).toContain('升级');
    expect(wrapper.text()).toContain('当前等级更高');
    expect(wrapper.get('[data-testid="carousel-page"]').text()).toBe('1 / 3');
  });

  it('keeps a delisted current membership visible and unavailable', () => {
    const delistedOverview: MembershipOverviewView = {
      ...overview,
      levels: overview.levels.filter((level) => level.id !== 'level-2'),
    };
    const wrapper = mount(MembershipCardCarousel, {
      props: { overview: delistedOverview },
      global: { components: { VanSwipe: Swipe, VanSwipeItem: SwipeItem } },
    });

    expect(wrapper.findAll('[data-testid="membership-card"]')).toHaveLength(3);
    expect(
      wrapper.findAll('[data-testid="membership-card"]')[0]!.text(),
    ).toContain('花漾卡');
    expect(
      wrapper.findAll('[data-testid="membership-card"]')[0]!.text(),
    ).toContain('当前等级已下架');
    expect(
      wrapper.findAll('[data-testid="membership-card"]')[0]!.attributes(),
    ).toHaveProperty('disabled');
  });

  it('uses zero duration when reduced motion is preferred', () => {
    const wrapper = mount(MembershipCardCarousel, {
      props: { overview, prefersReducedMotion: true },
      global: { components: { VanSwipe: Swipe, VanSwipeItem: SwipeItem } },
    });

    expect(wrapper.getComponent(Swipe).props('duration')).toBe(0);
  });

  it('emits the level id when a card is opened', async () => {
    const wrapper = mount(MembershipCardCarousel, {
      props: { overview },
      global: { components: { VanSwipe: Swipe, VanSwipeItem: SwipeItem } },
    });

    await wrapper
      .findAll('[data-testid="membership-card"]')[1]!
      .trigger('click');
    expect(wrapper.emitted('open')).toContainEqual(['level-3']);
  });
});
