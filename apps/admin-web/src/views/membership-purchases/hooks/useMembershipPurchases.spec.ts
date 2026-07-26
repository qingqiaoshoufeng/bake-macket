import {
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
import { effectScope, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { membershipPurchasesApi } from '../api/index.js';
import { useMembershipPurchases } from './useMembershipPurchases.js';

vi.mock('../api/index.js', () => ({
  membershipPurchasesApi: {
    list: vi.fn(),
    getOne: vi.fn(),
    voidPurchase: vi.fn(),
  },
}));

const api = vi.mocked(membershipPurchasesApi);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

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
      purchaseOrderId: 'purchase-initial',
      levelId: 'level-1',
      levelCode: 'PEARL_90',
      levelName: '珍珠季卡',
      levelRank: 10,
      discountBasisPoints: 9800,
      benefits: [{ title: '全场九八折', sortOrder: 0 }],
      cardTheme: { theme: MembershipTheme.PEARL, badgeText: 'FRESH BATCH' },
      startsAt: '2026-04-27T08:01:00.000Z',
      endsAt: '2026-10-24T08:01:00.000Z',
      previousMembershipId: null,
      status: MembershipStatus.ACTIVE,
      createdAt: '2026-04-27T08:01:00.000Z',
      updatedAt: '2026-07-26T08:01:00.000Z',
    },
  ],
  segment: {
    id: 'segment-1',
    membershipId: 'membership-1',
    purchaseOrderId: 'purchase-1',
    kind: MembershipEntitlementSegmentKind.RENEWAL,
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

function paginated(items: readonly MembershipPurchaseView[]) {
  return { items: [...items], page: 1, pageSize: 20, total: items.length };
}

describe('useMembershipPurchases', () => {
  afterEach(() => vi.resetAllMocks());

  it('queries pagination plus user, level, one purchase status, and time filters', async () => {
    api.list.mockResolvedValueOnce(paginated([row]));
    const state = useMembershipPurchases();
    state.setFilters({
      purchaseNo: ' MP2026 ',
      userId: ' user-1 ',
      levelId: ' level-1 ',
      status: MembershipPurchaseStatus.FULFILLED,
      createdAtRange: [
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-08-01T00:00:00.000Z'),
      ],
    });

    await state.search();

    expect(state.filters.status).toBe(MembershipPurchaseStatus.FULFILLED);
    expect(api.list).toHaveBeenCalledWith({
      purchaseNo: 'MP2026',
      userId: 'user-1',
      levelId: 'level-1',
      status: MembershipPurchaseStatus.FULFILLED,
      createdAtFrom: '2026-07-01T00:00:00.000Z',
      createdAtBefore: '2026-08-01T00:00:00.000Z',
      page: 1,
      pageSize: 20,
    });
    expect(state.purchases.value).toEqual([row]);
  });

  it('keeps only the latest list result and latest error state', async () => {
    const oldRequest = deferred<Awaited<ReturnType<typeof api.list>>>();
    const newRequest = deferred<Awaited<ReturnType<typeof api.list>>>();
    api.list
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const state = useMembershipPurchases();

    const oldLoad = state.setPage(2);
    const newLoad = state.setPage(3);
    newRequest.resolve({
      items: [{ ...row, id: 'purchase-new' }],
      page: 3,
      pageSize: 20,
      total: 1,
    });
    await newLoad;
    oldRequest.reject(new Error('旧筛选请求失败'));
    await oldLoad;

    expect(state.purchases.value.map(({ id }) => id)).toEqual(['purchase-new']);
    expect(state.page.value).toBe(3);
    expect(state.listError.value).toBeNull();
    expect(state.loading.value).toBe(false);
  });

  it('shows the full selected detail and takes renewal membershipId from its segment', async () => {
    api.getOne.mockResolvedValueOnce(detail);
    const state = useMembershipPurchases();

    await state.openDetail('purchase-1');

    expect(state.detail.value).toEqual(detail);
    expect(state.selectedMembershipId.value).toBe('membership-1');
    expect(state.detailVisible.value).toBe(true);
    expect(state.detailError.value).toBeNull();
  });

  it('isolates rapid purchase switches and does not let an old response overwrite the new selection', async () => {
    const oldRequest = deferred<AdminMembershipPurchaseDetailView>();
    const newDetail = {
      ...detail,
      purchase: {
        ...detail.purchase,
        id: 'purchase-2',
        purchaseNo: 'MP202607260002',
      },
    } satisfies AdminMembershipPurchaseDetailView;
    api.getOne
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(newDetail);
    const state = useMembershipPurchases();

    const oldOpen = state.openDetail('purchase-1');
    await state.openDetail('purchase-2');
    oldRequest.resolve(detail);
    await oldOpen;

    expect(state.detail.value?.purchase.id).toBe('purchase-2');
    expect(state.detailLoading.value).toBe(false);
  });

  it('invalidates detail requests on close so a late response cannot reopen or pollute state', async () => {
    const request = deferred<AdminMembershipPurchaseDetailView>();
    api.getOne.mockReturnValueOnce(request.promise);
    const state = useMembershipPurchases();

    const opening = state.openDetail('purchase-1');
    state.closeDetail();
    request.resolve(detail);
    await opening;

    expect(state.detailVisible.value).toBe(false);
    expect(state.detail.value).toBeNull();
    expect(state.detailLoading.value).toBe(false);
  });

  it('invalidates list and detail responses when its scope is disposed', async () => {
    const listRequest = deferred<Awaited<ReturnType<typeof api.list>>>();
    const detailRequest = deferred<AdminMembershipPurchaseDetailView>();
    api.list.mockReturnValueOnce(listRequest.promise);
    api.getOne.mockReturnValueOnce(detailRequest.promise);
    const scope = effectScope();
    const state = scope.run(useMembershipPurchases)!;

    const loadingList = state.load();
    const loadingDetail = state.openDetail('purchase-1');
    scope.stop();
    listRequest.resolve(paginated([row]));
    detailRequest.resolve(detail);
    await Promise.all([loadingList, loadingDetail]);
    await nextTick();

    expect(state.purchases.value).toEqual([]);
    expect(state.detail.value).toBeNull();
    expect(state.detailVisible.value).toBe(false);
  });

  it('uses the void endpoint detail as truth and updates only its corresponding light row', async () => {
    api.list.mockResolvedValueOnce(paginated([row]));
    api.getOne.mockResolvedValueOnce(detail);
    const voidedDetail = {
      ...detail,
      purchase: {
        ...detail.purchase,
        status: MembershipPurchaseStatus.VOIDED,
        paymentStatus: MembershipPaymentStatus.REVERSED,
        voidedAt: '2026-07-26T09:00:00.000Z',
      },
      grant: detail.grant
        ? { ...detail.grant, status: MemberCreditGrantStatus.REVERSED }
        : null,
      voidability: {
        allowed: false,
        reasonCode: MembershipPurchaseVoidReasonCode.PURCHASE_NOT_FULFILLED,
        reason: '购卡单未完成或已作废',
      },
    } satisfies AdminMembershipPurchaseDetailView;
    api.voidPurchase.mockResolvedValueOnce(voidedDetail);
    const state = useMembershipPurchases();
    await state.load();
    await state.openDetail('purchase-1');

    const result = await state.voidSelected();

    expect(result).toEqual({ status: 'applied', detail: voidedDetail });
    expect(state.detail.value).toEqual(voidedDetail);
    expect(state.purchases.value[0]).toMatchObject({
      id: 'purchase-1',
      status: MembershipPurchaseStatus.VOIDED,
      paymentStatus: MembershipPaymentStatus.REVERSED,
      voidedAt: '2026-07-26T09:00:00.000Z',
      voidability: voidedDetail.voidability,
    });
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-voidable selection and exposes endpoint failures without changing detail', async () => {
    const blockedDetail = {
      ...detail,
      voidability: {
        allowed: false,
        reasonCode: MembershipPurchaseVoidReasonCode.CREDIT_USED,
        reason: '赠送消费金已使用',
      },
    } satisfies AdminMembershipPurchaseDetailView;
    api.getOne.mockResolvedValueOnce(blockedDetail);
    const state = useMembershipPurchases();
    await state.openDetail('purchase-1');

    await expect(state.voidSelected()).rejects.toThrow('赠送消费金已使用');
    expect(api.voidPurchase).not.toHaveBeenCalled();

    api.getOne.mockResolvedValueOnce(detail);
    await state.openDetail('purchase-1');
    api.voidPurchase.mockRejectedValueOnce(new Error('锁内资格已变化'));
    await expect(state.voidSelected()).rejects.toThrow('锁内资格已变化');
    expect(state.actionError.value).toBe('锁内资格已变化');
    expect(state.detail.value).toEqual(detail);
  });

  it('does not leak an old void failure into a newly selected purchase', async () => {
    const action = deferred<AdminMembershipPurchaseDetailView>();
    const detailB = {
      ...detail,
      purchase: { ...detail.purchase, id: 'purchase-2', purchaseNo: 'MP-B' },
    } satisfies AdminMembershipPurchaseDetailView;
    api.getOne.mockResolvedValueOnce(detail).mockResolvedValueOnce(detailB);
    api.voidPurchase.mockReturnValueOnce(action.promise);
    const state = useMembershipPurchases();
    await state.openDetail('purchase-1');

    const voidingA = state.voidSelected();
    await state.openDetail('purchase-2');
    action.reject(new Error('A 作废失败'));

    await expect(voidingA).resolves.toEqual({ status: 'stale' });
    expect(state.detail.value).toEqual(detailB);
    expect(state.actionError.value).toBeNull();
    expect(state.voiding.value).toBe(false);
  });

  it('lets an old void success update its list row without overwriting the new detail', async () => {
    const action = deferred<AdminMembershipPurchaseDetailView>();
    const rowB = { ...row, id: 'purchase-2', purchaseNo: 'MP-B' };
    const detailB = {
      ...detail,
      purchase: { ...detail.purchase, id: 'purchase-2', purchaseNo: 'MP-B' },
    } satisfies AdminMembershipPurchaseDetailView;
    const voidedA = {
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
        reason: '已作废',
      },
    } satisfies AdminMembershipPurchaseDetailView;
    api.list.mockResolvedValueOnce(paginated([row, rowB]));
    api.getOne.mockResolvedValueOnce(detail).mockResolvedValueOnce(detailB);
    api.voidPurchase.mockReturnValueOnce(action.promise);
    const state = useMembershipPurchases();
    await state.load();
    await state.openDetail('purchase-1');

    const voidingA = state.voidSelected();
    await state.openDetail('purchase-2');
    action.resolve(voidedA);

    await expect(voidingA).resolves.toEqual({ status: 'stale' });
    expect(state.detail.value).toEqual(detailB);
    expect(
      state.purchases.value.find(({ id }) => id === 'purchase-1')?.status,
    ).toBe(MembershipPurchaseStatus.VOIDED);
    expect(
      state.purchases.value.find(({ id }) => id === 'purchase-2')?.status,
    ).toBe(MembershipPurchaseStatus.FULFILLED);
  });

  it('returns stale and emits no state after its scope is disposed during void', async () => {
    const action = deferred<AdminMembershipPurchaseDetailView>();
    api.getOne.mockResolvedValueOnce(detail);
    api.voidPurchase.mockReturnValueOnce(action.promise);
    const scope = effectScope();
    const state = scope.run(useMembershipPurchases)!;
    await state.openDetail('purchase-1');

    const voiding = state.voidSelected();
    scope.stop();
    action.reject(new Error('卸载后失败'));

    await expect(voiding).resolves.toEqual({ status: 'stale' });
    expect(state.actionError.value).toBeNull();
    expect(state.detailVisible.value).toBe(false);
  });

  it('keeps detail load failures visible and retryable', async () => {
    api.getOne.mockRejectedValueOnce(new Error('详情网络失败'));
    const state = useMembershipPurchases();

    await state.openDetail('purchase-1');

    expect(state.detailVisible.value).toBe(true);
    expect(state.detail.value).toBeNull();
    expect(state.detailError.value).toBe('详情网络失败');
    expect(state.selectedPurchaseId.value).toBe('purchase-1');
  });
});
