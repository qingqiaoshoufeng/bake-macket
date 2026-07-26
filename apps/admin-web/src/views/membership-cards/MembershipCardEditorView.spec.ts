import {
  ApiErrorCode,
  MembershipLevelStatus,
  MembershipTheme,
  type AdminMembershipLevelDetailView,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../api/http.js';
import MembershipCardEditorView from './MembershipCardEditorView.vue';
import { membershipCardsApi } from './api/index.js';

vi.mock('./api/index.js', () => ({
  membershipCardsApi: { getOne: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const api = vi.mocked(membershipCardsApi);
const detail: AdminMembershipLevelDetailView = {
  id: 'level-1',
  code: 'JADE_365',
  name: '翡翠年卡',
  rank: 30,
  priceCents: 29900,
  grantCreditCents: 36000,
  discountBasisPoints: 8800,
  validDays: 365,
  benefits: [{ title: '全场八八折', sortOrder: 0 }],
  cardTheme: { theme: MembershipTheme.JADE, badgeText: 'HOUSE RECIPE' },
  sortOrder: 3,
  status: MembershipLevelStatus.ACTIVE,
  version: 2,
  purchaseCount: 1,
  createdAt: '2026-07-21T08:00:00.000Z',
  updatedAt: '2026-07-21T09:00:00.000Z',
};

async function mountEditor() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/membership-cards', component: { template: '<div>list</div>' } },
      {
        path: '/membership-cards/:id/edit',
        name: 'admin-membership-card-edit',
        component: MembershipCardEditorView,
      },
    ],
  });
  await router.push('/membership-cards/level-1/edit');
  await router.isReady();
  const wrapper = mount(MembershipCardEditorView, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

describe('MembershipCardEditorView', () => {
  afterEach(() => vi.resetAllMocks());

  it('冲突时保留草稿，只在明确重新加载后覆盖', async () => {
    api.getOne.mockResolvedValue(detail);
    api.update.mockRejectedValueOnce(
      new ApiClientError(409, '会员等级已变化', {
        code: ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT,
      }),
    );
    const wrapper = await mountEditor();
    const form = wrapper.findComponent({ name: 'MembershipCardForm' });
    form.vm.$emit('update:form', { ...form.props('form'), name: '未保存草稿' });
    form.vm.$emit('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('配置已被其他操作更新');
    expect(wrapper.text()).toContain('当前草稿仍然保留');
    expect(form.props('form')).toMatchObject({ name: '未保存草稿' });
    expect(api.getOne).toHaveBeenCalledTimes(1);

    api.getOne.mockResolvedValue({ ...detail, name: '服务端最新配置' });
    await wrapper
      .get('[data-testid="reload-membership-card"]')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.findComponent({ name: 'MembershipCardForm' }).props('form'),
    ).toMatchObject({ name: '服务端最新配置' });
  });
});
