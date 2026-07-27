import { computed, readonly, ref } from 'vue';
import {
  MembershipPurchaseStatus,
  type MembershipOverviewView,
  type MembershipPurchaseView,
} from '@bake-mall/contracts';

import { generateIdempotencyKey } from '../../../utils/idempotency.js';
import { membershipFeatureApi } from '../api/index.js';
import type { MembershipPurchaseState } from '../type/index.js';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function mapMembershipPurchaseState(
  purchase: MembershipPurchaseView,
): MembershipPurchaseState {
  if (purchase.status === MembershipPurchaseStatus.FULFILLED) {
    return {
      kind: 'fulfilled',
      purchase,
      message: '烘焙护照已开通，会员资产已刷新。',
    };
  }
  if (purchase.status === MembershipPurchaseStatus.PENDING) {
    return {
      kind: 'pending',
      purchase,
      message: '购卡单已创建，等待支付完成。',
    };
  }
  return {
    kind: 'failed',
    purchase,
    message: '这笔购卡单未能完成，请返回会员中心重新选择。',
  };
}

export function useMembershipPurchase(
  options: { readonly isProduction?: boolean } = {},
) {
  const isProduction = options.isProduction ?? import.meta.env.PROD;
  const overview = ref<MembershipOverviewView | null>(null);
  const state = ref<MembershipPurchaseState>({
    kind: 'idle',
    purchase: null,
    message: null,
  });
  const submitting = ref(false);
  const createKey = ref<string | null>(null);
  const createLevelId = ref<string | null>(null);
  const paymentKey = ref<string | null>(null);
  const paymentPurchaseId = ref<string | null>(null);

  const canSimulatePayment = computed(
    () =>
      !isProduction &&
      overview.value?.simulatedPaymentEnabled === true &&
      state.value.purchase?.status === MembershipPurchaseStatus.PENDING,
  );

  async function refreshOverview(): Promise<MembershipOverviewView> {
    const next = await membershipFeatureApi.getOverview();
    overview.value = next;
    return next;
  }

  async function loadPurchase(
    purchaseId: string,
  ): Promise<MembershipPurchaseView> {
    try {
      const purchases = await membershipFeatureApi.listPurchases();
      const purchase = purchases.find(
        (candidate) => candidate.id === purchaseId,
      );
      if (!purchase) throw new Error('未找到这笔购卡记录');
      state.value = mapMembershipPurchaseState(purchase);
      await refreshOverview();
      return purchase;
    } catch (error) {
      state.value = {
        kind: 'failed',
        purchase: null,
        message: errorMessage(error, '购卡结果加载失败，请重试。'),
      };
      throw error;
    }
  }

  async function create(levelId: string): Promise<MembershipPurchaseView> {
    if (isProduction) throw new Error('生产环境暂未开放会员购买');
    if (createLevelId.value && createLevelId.value !== levelId) {
      createKey.value = null;
    }
    createLevelId.value = levelId;
    const key = createKey.value ?? generateIdempotencyKey();
    createKey.value = key;
    submitting.value = true;
    try {
      const purchase = await membershipFeatureApi.createPurchase(
        { levelId },
        key,
      );
      state.value = mapMembershipPurchaseState(purchase);
      createKey.value = null;
      createLevelId.value = null;
      return purchase;
    } catch (error) {
      state.value = {
        kind: 'failed',
        purchase: state.value.purchase,
        message: errorMessage(error, '购卡单创建失败，请重试。'),
      };
      throw error;
    } finally {
      submitting.value = false;
    }
  }

  async function simulatePayment(): Promise<MembershipPurchaseView> {
    if (isProduction) throw new Error('生产环境不可使用模拟支付');
    const purchase = state.value.purchase;
    if (!purchase || purchase.status !== MembershipPurchaseStatus.PENDING) {
      throw new Error('当前没有待支付购卡单');
    }
    const currentOverview = overview.value ?? (await refreshOverview());
    if (!currentOverview.simulatedPaymentEnabled) {
      throw new Error('当前环境未开启模拟支付');
    }
    if (paymentPurchaseId.value && paymentPurchaseId.value !== purchase.id) {
      paymentKey.value = null;
    }
    paymentPurchaseId.value = purchase.id;
    const key = paymentKey.value ?? generateIdempotencyKey();
    paymentKey.value = key;
    submitting.value = true;
    try {
      const fulfilled = await membershipFeatureApi.simulatePayment(
        purchase.id,
        key,
      );
      state.value = mapMembershipPurchaseState(fulfilled);
      paymentKey.value = null;
      paymentPurchaseId.value = null;
      await refreshOverview();
      return fulfilled;
    } catch (error) {
      state.value = {
        kind: 'failed',
        purchase,
        message: errorMessage(error, '模拟支付失败，请重试。'),
      };
      throw error;
    } finally {
      submitting.value = false;
    }
  }

  return {
    data: { overview: readonly(overview) },
    state: readonly(state),
    submitting: readonly(submitting),
    canSimulatePayment,
    methods: { create, loadPurchase, refreshOverview, simulatePayment },
  };
}
