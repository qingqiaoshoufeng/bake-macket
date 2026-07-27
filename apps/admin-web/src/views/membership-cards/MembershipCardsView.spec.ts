import {
  MembershipLevelStatus,
  MembershipTheme,
  type AdminMembershipLevelListItem,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { ElButton } from 'element-plus';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MembershipCardsView from './MembershipCardsView.vue';
import { membershipCardsApi } from './api/index.js';

vi.mock('./api/index.js', () => ({
  membershipCardsApi: {
    list: vi.fn(),
    updateStatus: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(membershipCardsApi);
const level: AdminMembershipLevelListItem = {
  id: 'level-1',
  code: 'PEARL_90',
  name: '珍珠季卡',
  rank: 10,
  priceCents: 9900,
  grantCreditCents: 12000,
  discountBasisPoints: 9800,
  validDays: 90,
  benefits: [],
  cardTheme: { theme: MembershipTheme.PEARL, badgeText: 'FRESH BATCH' },
  sortOrder: 10,
  status: MembershipLevelStatus.INACTIVE,
  version: 1,
  purchaseCount: 0,
  createdAt: '2026-07-21T08:00:00.000Z',
  updatedAt: '2026-07-21T09:00:00.000Z',
};

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/membership-cards', component: MembershipCardsView },
      {
        path: '/membership-cards/new',
        component: { template: '<div>new card</div>' },
      },
      {
        path: '/membership-cards/:id/edit',
        component: { template: '<div>edit card</div>' },
      },
    ],
  });
  await router.push('/membership-cards');
  await router.isReady();
  const wrapper = mount(MembershipCardsView, {
    global: {
      plugins: [router],
      directives: { loading: {} },
      components: { 'el-button': ElButton },
      stubs: { MembershipCardTable: true },
    },
  });
  await flushPromises();
  return { router, wrapper };
}

describe('MembershipCardsView', () => {
  afterEach(() => vi.resetAllMocks());

  it('从生产 API 加载列表并导航到新建和编辑页面', async () => {
    api.list.mockResolvedValue({
      items: [level],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const { router, wrapper } = await mountView();

    expect(api.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(wrapper.findComponent({ name: 'AdminFilterPanel' }).exists()).toBe(
      true,
    );
    const table = wrapper.findComponent({ name: 'MembershipCardTable' });
    expect(table.props('levels')).toEqual([level]);

    await wrapper
      .get('[data-testid="create-membership-card"]')
      .trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/membership-cards/new');
  });

  it('加载失败时保留可操作错误态并允许重新加载', async () => {
    api.list
      .mockRejectedValueOnce(new Error('服务不可用'))
      .mockResolvedValueOnce({
        items: [level],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    const { wrapper } = await mountView();

    expect(wrapper.text()).toContain('会员卡列表加载失败');
    expect(wrapper.text()).toContain('服务不可用');
    await wrapper.get('.el-alert button').trigger('click');
    await flushPromises();
    expect(api.list).toHaveBeenCalledTimes(2);
  });
});
