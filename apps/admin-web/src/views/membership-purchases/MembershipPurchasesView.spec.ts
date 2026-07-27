import {
  MembershipLevelStatus,
  MemberCreditDirection,
  MemberCreditEntryType,
  MemberCreditGrantStatus,
  MembershipEntitlementSegmentKind,
  MembershipPaymentChannel,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipPurchaseVoidReasonCode,
  MembershipStatus,
  MembershipTheme,
  type AdminMembershipPurchaseDetailView,
  type MembershipPurchaseView,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import {
  ElButton,
  ElMessage,
  ElMessageBox,
  type MessageBoxData,
} from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { membershipPurchasesApi } from './api/index.js';
import MembershipPurchasesView from './MembershipPurchasesView.vue';

vi.mock('./api/index.js', () => ({
  membershipPurchasesApi: {
    list: vi.fn(),
    getOne: vi.fn(),
    voidPurchase: vi.fn(),
  },
}));
vi.mock('../membership-cards/api/index.js', () => ({
  membershipCardsApi: {
    list: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'level-1',
          code: 'PEARL_90',
          name: '珍珠季卡',
          status: MembershipLevelStatus.ACTIVE,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    }),
  },
}));

const api = vi.mocked(membershipPurchasesApi);
const confirm = vi.spyOn(ElMessageBox, 'confirm');
const success = vi
  .spyOn(ElMessage, 'success')
  .mockImplementation(() => ({ close: vi.fn() }));
const error = vi
  .spyOn(ElMessage, 'error')
  .mockImplementation(() => ({ close: vi.fn() }));
const confirmedMessageBoxResult = Object.assign('confirm' as const, {
  action: 'confirm' as const,
  value: '',
}) satisfies MessageBoxData;

const row: MembershipPurchaseView = {
  id: 'purchase-1',
  userId: 'user-1',
  purchaseNo: 'MP202607260001',
  levelId: 'level-1',
  levelCode: 'PEARL_90',
  levelName: '珍珠季卡',
  levelRank: 10,
  priceCents: 9900,
  grantCreditCents: 12000,
  discountBasisPoints: 9800,
  validDays: 90,
  cardTheme: { theme: MembershipTheme.PEARL, badgeText: 'FRESH BATCH' },
  status: MembershipPurchaseStatus.FULFILLED,
  paymentStatus: MembershipPaymentStatus.SUCCEEDED,
  membershipId: 'membership-1',
  voidability: { allowed: true },
  paidAt: '2026-07-26T08:01:00.000Z',
  createdAt: '2026-07-26T08:00:00.000Z',
  updatedAt: '2026-07-26T08:01:00.000Z',
};

const detail = {
  purchase: {
    ...row,
    userId: 'user-1',
    benefits: [{ title: '全场九八折', sortOrder: 0 }],
    paymentChannel: MembershipPaymentChannel.SIMULATED,
    status: MembershipPurchaseStatus.FULFILLED,
    paymentStatus: MembershipPaymentStatus.SUCCEEDED,
    membershipId: 'membership-1',
    paidAt: '2026-07-26T08:01:00.000Z',
    voidedAt: null,
  },
  membershipChain: [
    {
      id: 'membership-1',
      userId: 'user-1',
      purchaseOrderId: 'purchase-1',
      levelId: 'level-1',
      levelCode: 'PEARL_90',
      levelName: '珍珠季卡',
      levelRank: 10,
      discountBasisPoints: 9800,
      benefits: [{ title: '全场九八折', sortOrder: 0 }],
      cardTheme: { theme: MembershipTheme.PEARL, badgeText: 'FRESH BATCH' },
      startsAt: '2026-07-26T08:01:00.000Z',
      endsAt: '2026-10-24T08:01:00.000Z',
      previousMembershipId: null,
      status: MembershipStatus.ACTIVE,
      createdAt: '2026-07-26T08:01:00.000Z',
      updatedAt: '2026-07-26T08:01:00.000Z',
    },
  ],
  segment: {
    id: 'segment-1',
    membershipId: 'membership-1',
    purchaseOrderId: 'purchase-1',
    kind: MembershipEntitlementSegmentKind.INITIAL,
    startsAt: '2026-07-26T08:01:00.000Z',
    endsAt: '2026-10-24T08:01:00.000Z',
    previousMembershipId: null,
    previousMembershipEndsAt: null,
    createdAt: '2026-07-26T08:01:00.000Z',
  },
  grant: {
    id: 'grant-1',
    accountId: 'account-1',
    purchaseOrderId: 'purchase-1',
    grantedCents: 12000,
    remainingCents: 12000,
    status: MemberCreditGrantStatus.ACTIVE,
    createdAt: '2026-07-26T08:01:00.000Z',
    updatedAt: '2026-07-26T08:01:00.000Z',
  },
  entries: [
    {
      id: 'entry-1',
      accountId: 'account-1',
      direction: MemberCreditDirection.CREDIT,
      type: MemberCreditEntryType.MEMBERSHIP_PURCHASE_GRANT,
      amountCents: 12000,
      balanceAfterCents: 12000,
      referenceType: 'MEMBERSHIP_PURCHASE',
      referenceId: 'purchase-1',
      operationKey: 'membership-purchase-grant:purchase-1',
      reversalOfEntryId: null,
      createdAt: '2026-07-26T08:01:00.000Z',
    },
  ],
  voidability: { allowed: true },
} satisfies AdminMembershipPurchaseDetailView;

function mountView() {
  return mount(MembershipPurchasesView, {
    global: {
      directives: { loading: {} },
      components: { 'el-button': ElButton },
    },
  });
}

describe('MembershipPurchasesView', () => {
  afterEach(() => vi.resetAllMocks());

  it('使用统一筛选面板并独立提供履约、支付和可读等级筛选', async () => {
    api.list.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.findComponent({ name: 'AdminFilterPanel' }).exists()).toBe(
      true,
    );
    expect(wrapper.find('[aria-label="筛选购卡状态"]').exists()).toBe(true);
    await wrapper.get('[data-testid="toggle-advanced"]').trigger('click');
    expect(wrapper.find('[aria-label="筛选支付状态"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="筛选用户手机号"]').exists()).toBe(true);
    expect(
      wrapper
        .findComponent({ name: 'MembershipPurchaseFilters' })
        .props('levelOptions'),
    ).toEqual([{ value: 'level-1', label: '珍珠季卡（PEARL_90）' }]);
  });

  it('renders actionable list errors and empty state inside the shared Admin system', async () => {
    api.list.mockRejectedValueOnce(new Error('购卡列表网络失败'));
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
    expect(wrapper.text()).toContain('购卡列表网络失败');
    expect(wrapper.get('[data-testid="retry-purchase-list"]').text()).toContain(
      '重新加载',
    );

    api.list.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    await wrapper.get('[data-testid="retry-purchase-list"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('没有符合条件的购卡记录');
  });

  it('shows complete detail groups and keeps status text independent from color', async () => {
    api.list.mockResolvedValueOnce({
      items: [row],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    api.getOne.mockResolvedValueOnce(detail);
    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="open-purchase-purchase-1"]')
      .trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('购买与支付快照');
    expect(wrapper.text()).toContain('会员链');
    expect(wrapper.text()).toContain('有效期贡献');
    expect(wrapper.text()).toContain('消费金 grant');
    expect(wrapper.text()).toContain('发放与冲正流水');
    expect(wrapper.text()).toContain('可作废');
    expect(wrapper.text()).toContain('支付成功');
    expect(wrapper.text()).toContain('membership-1');
  });

  it('renders complete contract identifiers, relations, snapshots, and timestamps', async () => {
    const completeDetail = {
      ...detail,
      purchase: {
        ...detail.purchase,
        id: 'purchase-id-unique',
        levelRank: 37,
        benefits: [
          {
            title: '购买权益唯一值',
            description: '购买权益描述唯一值',
            iconKey: 'purchase-icon-unique',
            sortOrder: 13,
          },
        ],
        createdAt: '2042-01-02T03:04:05.000Z',
        updatedAt: '2042-02-03T04:05:06.000Z',
      },
      membershipChain: [
        {
          ...detail.membershipChain[0],
          userId: 'chain-user-unique',
          purchaseOrderId: 'chain-purchase-unique',
          levelCode: 'CHAIN_CODE_UNIQUE',
          levelRank: 47,
          discountBasisPoints: 9123,
          benefits: [
            {
              title: '链路权益唯一值',
              description: '链路权益描述唯一值',
              iconKey: 'chain-icon-unique',
              sortOrder: 7,
            },
          ],
          createdAt: '2043-02-03T04:05:06.000Z',
          cardTheme: {
            theme: MembershipTheme.OBSIDIAN,
            badgeText: 'CHAIN THEME UNIQUE',
          },
          updatedAt: '2043-03-04T05:06:07.000Z',
        },
      ],
      segment: {
        ...detail.segment,
        id: 'segment-id-unique',
        purchaseOrderId: 'segment-purchase-unique',
        createdAt: '2044-04-05T06:07:08.000Z',
      },
      grant: detail.grant
        ? {
            ...detail.grant,
            accountId: 'grant-account-unique',
            purchaseOrderId: 'grant-purchase-unique',
            createdAt: '2045-05-06T07:08:09.000Z',
            updatedAt: '2045-06-07T08:09:10.000Z',
          }
        : null,
      entries: [
        {
          ...detail.entries[0],
          id: 'entry-id-unique',
          accountId: 'entry-account-unique',
          referenceType: 'REFERENCE_TYPE_UNIQUE',
          referenceId: 'reference-id-unique',
          createdAt: '2046-07-08T09:10:11.000Z',
        },
      ],
    } satisfies AdminMembershipPurchaseDetailView;
    api.list.mockResolvedValueOnce({
      items: [row],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    api.getOne.mockResolvedValueOnce(completeDetail);
    const wrapper = mountView();
    await flushPromises();
    await wrapper
      .get('[data-testid="open-purchase-purchase-1"]')
      .trigger('click');
    await flushPromises();

    [
      '购买记录 ID',
      'purchase-id-unique',
      '等级 rank',
      '37',
      '创建时间',
      '2042',
      '更新时间',
      '购买权益唯一值',
      '购买权益描述唯一值',
      'purchase-icon-unique',
      '#13',
      'chain-user-unique',
      'chain-purchase-unique',
      'CHAIN_CODE_UNIQUE',
      '47',
      '9.123 折',
      '链路权益唯一值',
      '链路权益描述唯一值',
      'chain-icon-unique',
      '#7',
      'CHAIN THEME UNIQUE',
      '2043',
      'segment-id-unique',
      'segment-purchase-unique',
      '2044',
      'grant-account-unique',
      'grant-purchase-unique',
      '2045',
      'entry-id-unique',
      'entry-account-unique',
      'REFERENCE_TYPE_UNIQUE',
      'reference-id-unique',
      '2046',
    ].forEach((value) => expect(wrapper.text()).toContain(value));
  });

  it('confirms the credit and validity impact before voiding and uses returned detail', async () => {
    const voidedDetail = {
      ...detail,
      purchase: {
        ...detail.purchase,
        status: MembershipPurchaseStatus.VOIDED,
        paymentStatus: MembershipPaymentStatus.REVERSED,
        voidedAt: '2026-07-26T09:00:00.000Z',
      },
      voidability: {
        allowed: false,
        reasonCode: MembershipPurchaseVoidReasonCode.PURCHASE_NOT_FULFILLED,
        reason: '购卡单未完成或已作废',
      },
    } satisfies AdminMembershipPurchaseDetailView;
    api.list.mockResolvedValueOnce({
      items: [row],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    api.getOne.mockResolvedValueOnce(detail);
    api.voidPurchase.mockResolvedValueOnce(voidedDetail);
    confirm.mockResolvedValueOnce(confirmedMessageBoxResult);
    const wrapper = mountView();
    await flushPromises();
    await wrapper
      .get('[data-testid="open-purchase-purchase-1"]')
      .trigger('click');
    await flushPromises();

    await wrapper
      .get('[data-testid="void-membership-purchase"]')
      .trigger('click');
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('冲销本次剩余赠送消费金'),
      '作废购卡记录',
      expect.objectContaining({ confirmButtonText: '确认作废' }),
    );
    expect(confirm.mock.calls[0]?.[0]).toContain('回退或恢复会员有效期');
    expect(api.voidPurchase).toHaveBeenCalledWith('purchase-1');
    expect(wrapper.text()).toContain('已作废');
    expect(success).toHaveBeenCalledWith('购卡记录已作废');
  });

  it('does not call void after confirmation cancellation', async () => {
    api.list.mockResolvedValueOnce({
      items: [row],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    api.getOne.mockResolvedValueOnce(detail);
    confirm.mockRejectedValueOnce('cancel');
    const wrapper = mountView();
    await flushPromises();
    await wrapper
      .get('[data-testid="open-purchase-purchase-1"]')
      .trigger('click');
    await flushPromises();

    await wrapper
      .get('[data-testid="void-membership-purchase"]')
      .trigger('click');
    await flushPromises();

    expect(api.voidPurchase).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('does not show a global message when void completion becomes stale after unmount', async () => {
    let rejectAction!: (reason?: unknown) => void;
    const action = new Promise<AdminMembershipPurchaseDetailView>(
      (_, reject) => {
        rejectAction = reject;
      },
    );
    api.list.mockResolvedValueOnce({
      items: [row],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    api.getOne.mockResolvedValueOnce(detail);
    api.voidPurchase.mockReturnValueOnce(action);
    confirm.mockResolvedValueOnce(confirmedMessageBoxResult);
    const wrapper = mountView();
    await flushPromises();
    await wrapper
      .get('[data-testid="open-purchase-purchase-1"]')
      .trigger('click');
    await flushPromises();

    await wrapper
      .get('[data-testid="void-membership-purchase"]')
      .trigger('click');
    wrapper.unmount();
    rejectAction(new Error('卸载后失败'));
    await flushPromises();

    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('surfaces final server authorization failures and keeps the detail operable', async () => {
    api.list.mockResolvedValueOnce({
      items: [row],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    api.getOne.mockResolvedValueOnce(detail);
    api.voidPurchase.mockRejectedValueOnce(new Error('权益已在其他请求中使用'));
    confirm.mockResolvedValueOnce(confirmedMessageBoxResult);
    const wrapper = mountView();
    await flushPromises();
    await wrapper
      .get('[data-testid="open-purchase-purchase-1"]')
      .trigger('click');
    await flushPromises();

    await wrapper
      .get('[data-testid="void-membership-purchase"]')
      .trigger('click');
    await flushPromises();

    expect(error).toHaveBeenCalledWith('权益已在其他请求中使用');
    expect(wrapper.text()).toContain('权益已在其他请求中使用');
    expect(
      wrapper.get('[data-testid="void-membership-purchase"]').attributes(),
    ).not.toHaveProperty('disabled');
  });
});
