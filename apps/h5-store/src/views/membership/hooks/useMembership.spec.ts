import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipStatus,
  MembershipTheme,
  type MembershipOverviewView,
  type MembershipPurchaseView,
  type PublicMembershipLevelView,
} from '@bake-mall/contracts';

import MembershipPurchasePanel from '../components/MembershipPurchasePanel.vue';
import { getMembershipPurchaseCapability } from './purchase-capability.js';
import { useMembershipPurchase } from './useMembershipPurchase.js';

const apiMocks = vi.hoisted(() => ({
  createPurchase: vi.fn(),
  getOverview: vi.fn(),
  simulatePayment: vi.fn(),
}));
const keyMocks = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('../api/index.js', () => ({
  membershipFeatureApi: {
    createPurchase: apiMocks.createPurchase,
    getOverview: apiMocks.getOverview,
    simulatePayment: apiMocks.simulatePayment,
  },
}));
vi.mock('../../../utils/idempotency.js', () => ({
  generateIdempotencyKey: keyMocks.generate,
}));

const levels: PublicMembershipLevelView[] = [
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
];

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
    cardTheme: levels[1]!.cardTheme,
    benefits: [],
  },
  account: { availableCreditCents: 3000, version: 1 },
  levels,
  simulatedPaymentEnabled: true,
};

const pendingPurchase: MembershipPurchaseView = {
  id: 'purchase-1',
  purchaseNo: 'MP202607260001',
  levelId: 'level-3',
  levelCode: 'HARVEST',
  levelName: '丰穗卡',
  levelRank: 3,
  priceCents: 29900,
  grantCreditCents: 5000,
  discountBasisPoints: 8500,
  validDays: 365,
  cardTheme: levels[2]!.cardTheme,
  status: MembershipPurchaseStatus.PENDING,
  paymentStatus: MembershipPaymentStatus.PENDING,
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
};

describe('membership purchase capability', () => {
  it('uses current overview rank and status for renewal, upgrade, and downgrade blocking', () => {
    expect(getMembershipPurchaseCapability(overview, levels[1]!)).toMatchObject(
      {
        action: 'renew',
        allowed: true,
      },
    );
    expect(getMembershipPurchaseCapability(overview, levels[2]!)).toMatchObject(
      {
        action: 'upgrade',
        allowed: true,
      },
    );
    expect(getMembershipPurchaseCapability(overview, levels[0]!)).toMatchObject(
      {
        action: 'blocked',
        allowed: false,
      },
    );
    expect(
      getMembershipPurchaseCapability(
        {
          ...overview,
          currentMembership: {
            ...overview.currentMembership!,
            status: MembershipStatus.EXPIRED,
          },
        },
        levels[0]!,
      ),
    ).toMatchObject({ action: 'purchase', allowed: true });
  });
});

describe('MembershipPurchasePanel production gate', () => {
  it('renders no purchase trigger and explains unavailability in production', () => {
    const wrapper = mount(MembershipPurchasePanel, {
      props: {
        level: levels[2]!,
        capability: {
          action: 'upgrade',
          allowed: true,
          label: '升级',
          description: '立即升级到更高等级',
        },
        state: { kind: 'idle', purchase: null, message: null },
        submitting: false,
        canSimulatePayment: true,
        isProduction: true,
      },
    });

    expect(wrapper.find('[data-testid="purchase"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="simulate-payment"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain('购买暂未开放');
    expect(wrapper.emitted('purchase')).toBeUndefined();
  });
});

describe('useMembershipPurchase', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    keyMocks.generate.mockImplementation(() =>
      apiMocks.createPurchase.mock.calls.length === 0
        ? 'create-key'
        : 'payment-key',
    );
    apiMocks.getOverview.mockResolvedValue(overview);
    apiMocks.createPurchase.mockResolvedValue(pendingPurchase);
    apiMocks.simulatePayment.mockResolvedValue({
      ...pendingPurchase,
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
    });
  });

  function setup(isProduction = false) {
    let membership: ReturnType<typeof useMembershipPurchase> | null = null;
    const wrapper = mount({
      setup() {
        membership = useMembershipPurchase({ isProduction });
        return {};
      },
      template: '<div />',
    });
    return {
      wrapper,
      get membership() {
        return membership as unknown as ReturnType<
          typeof useMembershipPurchase
        >;
      },
    };
  }

  it('reuses one create key across retries and clears it only after success', async () => {
    apiMocks.createPurchase
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(pendingPurchase);
    const context = setup();

    await expect(
      context.membership.methods.create(levels[2]!.id),
    ).rejects.toThrow('network');
    await context.membership.methods.create(levels[2]!.id);

    expect(apiMocks.createPurchase).toHaveBeenNthCalledWith(
      1,
      { levelId: 'level-3' },
      'create-key',
    );
    expect(apiMocks.createPurchase).toHaveBeenNthCalledWith(
      2,
      { levelId: 'level-3' },
      'create-key',
    );
    expect(keyMocks.generate).toHaveBeenCalledOnce();
    context.wrapper.unmount();
  });

  it('reuses the simulated payment key after failure and refreshes overview after fulfillment', async () => {
    const context = setup();

    apiMocks.simulatePayment
      .mockRejectedValueOnce(new Error('payment network'))
      .mockResolvedValueOnce({
        ...pendingPurchase,
        status: MembershipPurchaseStatus.FULFILLED,
        paymentStatus: MembershipPaymentStatus.SUCCEEDED,
      });
    await context.membership.methods.create(levels[2]!.id);
    expect(context.membership.state.value.kind).toBe('pending');
    const overviewCallsBeforePayment = apiMocks.getOverview.mock.calls.length;
    await expect(context.membership.methods.simulatePayment()).rejects.toThrow(
      'payment network',
    );
    expect(context.membership.state.value.kind).toBe('failed');
    await context.membership.methods.simulatePayment();

    expect(apiMocks.simulatePayment).toHaveBeenNthCalledWith(
      1,
      pendingPurchase.id,
      'payment-key',
    );
    expect(apiMocks.simulatePayment).toHaveBeenNthCalledWith(
      2,
      pendingPurchase.id,
      'payment-key',
    );
    expect(context.membership.state.value.kind).toBe('fulfilled');
    expect(apiMocks.getOverview).toHaveBeenCalledTimes(
      overviewCallsBeforePayment + 2,
    );
    context.wrapper.unmount();
  });

  it('rejects creating a pending purchase before calling the API in production', async () => {
    const context = setup(true);

    await expect(
      context.membership.methods.create(levels[2]!.id),
    ).rejects.toThrow('生产环境暂未开放会员购买');
    expect(apiMocks.createPurchase).not.toHaveBeenCalled();
    expect(keyMocks.generate).not.toHaveBeenCalled();
    expect(context.membership.state.value.kind).toBe('idle');
    context.wrapper.unmount();
  });

  it('does not expose or trigger simulated payment in production', async () => {
    const context = setup(true);

    expect(context.membership.canSimulatePayment.value).toBe(false);
    await expect(context.membership.methods.simulatePayment()).rejects.toThrow(
      '生产环境不可使用模拟支付',
    );
    expect(apiMocks.simulatePayment).not.toHaveBeenCalled();
    context.wrapper.unmount();
  });
});
