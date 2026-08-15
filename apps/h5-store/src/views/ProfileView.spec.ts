import { createPinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
  MembershipStatus,
  MembershipTheme,
  type MembershipOverviewView,
} from '@bake-mall/contracts';

import ProfileView from './ProfileView.vue';

const apiMocks = vi.hoisted(() => ({
  getMembership: vi.fn(),
  getProfile: vi.fn(),
  updateOrderContactPhone: vi.fn(),
}));

vi.mock('./membership/api/index.js', () => ({
  membershipFeatureApi: {
    getOverview: apiMocks.getMembership,
    listCreditEntries: vi.fn(),
    listPurchases: vi.fn(),
  },
}));
vi.mock('./profile/api/index.js', () => ({
  profileFeatureApi: {
    get: apiMocks.getProfile,
    updateOrderContactPhone: apiMocks.updateOrderContactPhone,
  },
}));
vi.mock('vant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vant')>();
  return { ...actual, showToast: vi.fn() };
});

const overview: MembershipOverviewView = {
  currentMembership: null,
  account: { availableCreditCents: 0, version: 0 },
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
  ],
  simulatedPaymentEnabled: true,
};

async function mountProfile(path = '/profile') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/profile', component: ProfileView },
      { path: '/checkout', component: { template: '<div>checkout</div>' } },
    ],
  });
  await router.push(path);
  const wrapper = mount(ProfileView, {
    global: { plugins: [createPinia(), router] },
  });
  await flushPromises();
  return wrapper;
}

describe('ProfileView membership isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getProfile.mockResolvedValue({
      id: 'user-1',
      nickname: '小麦',
      avatarUrl: null,
      phone: '138****0000',
      phoneVerified: true,
      orderContactPhone: {
        configured: false,
        maskedPhone: null,
        version: 0,
      },
    });
    apiMocks.updateOrderContactPhone.mockResolvedValue({
      configured: true,
      maskedPhone: '139****0000',
      version: 1,
    });
    apiMocks.getMembership.mockResolvedValue(overview);
  });

  it('keeps identity and original links usable when membership fails', async () => {
    apiMocks.getMembership.mockRejectedValueOnce(new Error('会员接口失败'));
    const wrapper = await mountProfile();

    expect(wrapper.text()).toContain('小麦');
    expect(wrapper.text()).toContain('我的订单');
    expect(wrapper.text()).toContain('会员资产加载失败');
    expect(wrapper.find('[data-testid="membership-retry"]').exists()).toBe(
      true,
    );
  });

  it('renders the current membership snapshot when no active levels remain', async () => {
    apiMocks.getMembership.mockResolvedValueOnce({
      ...overview,
      currentMembership: {
        id: 'membership-retired',
        levelId: 'level-retired',
        code: 'RETIRED',
        name: '珍藏下架卡',
        rank: 9,
        discountBasisPoints: 8800,
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2027-01-01T00:00:00.000Z',
        status: MembershipStatus.ACTIVE,
        cardTheme: { theme: MembershipTheme.OBSIDIAN, badgeText: '珍藏' },
        benefits: [{ title: '历史权益仍有效', sortOrder: 1 }],
      },
      levels: [],
    });

    const wrapper = await mountProfile();

    expect(wrapper.text()).toContain('珍藏下架卡');
    expect(wrapper.text()).toContain('当前等级已下架');
    expect(wrapper.text()).not.toContain('会员服务准备中');
  });

  it('retries only the membership region after its error', async () => {
    apiMocks.getMembership
      .mockRejectedValueOnce(new Error('会员接口失败'))
      .mockResolvedValueOnce(overview);
    const wrapper = await mountProfile();

    await wrapper.get('[data-testid="membership-retry"]').trigger('click');
    await flushPromises();

    expect(apiMocks.getMembership).toHaveBeenCalledTimes(2);
    expect(apiMocks.getProfile).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('麦芽卡');
  });

  it('明确区分身份手机号与订单联系手机号', async () => {
    const wrapper = await mountProfile();

    expect(wrapper.text()).toContain('身份手机号');
    expect(wrapper.text()).toContain('订单联系手机号');
    expect(wrapper.get('[data-testid="edit-order-contact-phone"]').text()).toBe(
      '设置',
    );
  });

  it('query 自动展开并在保存后安全返回 checkout', async () => {
    const wrapper = await mountProfile(
      '/profile?edit=order-contact-phone&redirect=/checkout',
    );
    const router = wrapper.vm.$router;

    await wrapper
      .get('[data-testid="order-contact-phone-input"]')
      .setValue('13900000000');
    await wrapper.get('form.profile-contact__form').trigger('submit.prevent');
    await flushPromises();

    expect(apiMocks.updateOrderContactPhone).toHaveBeenCalledWith({
      phone: '13900000000',
      expectedVersion: 0,
    });
    expect(router.currentRoute.value.path).toBe('/checkout');
  });
});
