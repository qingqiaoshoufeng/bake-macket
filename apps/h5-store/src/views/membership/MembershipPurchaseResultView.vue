<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';

import StoreStatePanel from '../../components/feedback/StoreStatePanel.vue';
import StorePage from '../../components/layout/StorePage.vue';
import StorePageHeader from '../../components/layout/StorePageHeader.vue';
import MembershipPurchasePanel from './components/MembershipPurchasePanel.vue';
import { useMembershipPurchase } from './hooks/useMembershipPurchase.js';

const route = useRoute();
const router = useRouter();
const purchase = useMembershipPurchase();
const isProduction = import.meta.env.PROD;
const purchaseLevel = computed(() => {
  const current = purchase.state.value.purchase;
  return current
    ? {
        id: current.levelId,
        code: current.levelCode,
        name: current.levelName,
        rank: current.levelRank,
        priceCents: current.priceCents,
        grantCreditCents: current.grantCreditCents,
        discountBasisPoints: current.discountBasisPoints,
        validDays: current.validDays,
        benefits: [],
        cardTheme: current.cardTheme,
        sortOrder: current.levelRank,
      }
    : null;
});

async function load(id: string): Promise<void> {
  try {
    await purchase.methods.loadPurchase(id);
  } catch {
    showToast('购卡结果加载失败');
  }
}

function loadRoutePurchase(id: unknown): void {
  if (typeof id === 'string' && id) void load(id);
}

async function simulatePayment(): Promise<void> {
  try {
    await purchase.methods.simulatePayment();
    showToast({ type: 'success', message: '模拟支付成功，会员资产已刷新' });
  } catch {
    showToast('模拟支付失败，请重试');
  }
}

onMounted(() => loadRoutePurchase(route.params.id));
watch(() => route.params.id, loadRoutePurchase);
</script>

<template>
  <StorePage compact class="purchase-result">
    <StorePageHeader
      back
      title="购卡结果"
      eyebrow="PASSPORT STATUS"
      description="清晰确认待支付、已开通或失败状态。"
      @back="router.push('/membership-cards')"
    />
    <StoreStatePanel
      v-if="purchase.state.value.kind === 'idle'"
      state="loading"
      title="正在核对购卡单"
      description="马上呈现最新状态。"
    />
    <StoreStatePanel
      v-else-if="!purchaseLevel || !purchase.state.value.purchase"
      state="error"
      title="购卡结果加载失败"
      :description="purchase.state.value.message ?? '暂时无法读取这笔购卡单。'"
    >
      <template #action>
        <button
          class="purchase-result__button"
          type="button"
          @click="loadRoutePurchase(route.params.id)"
        >
          重新加载
        </button>
      </template>
    </StoreStatePanel>
    <template v-else>
      <section
        class="purchase-result__passport"
        :data-kind="purchase.state.value.kind"
      >
        <span class="purchase-result__seal" aria-hidden="true">
          {{
            purchase.state.value.kind === 'fulfilled'
              ? '✓'
              : purchase.state.value.kind === 'pending'
                ? '…'
                : '!'
          }}
        </span>
        <p>{{ purchase.state.value.kind.toUpperCase() }}</p>
        <h2>
          {{
            purchase.state.value.kind === 'fulfilled'
              ? '烘焙护照已开通'
              : purchase.state.value.kind === 'pending'
                ? '等待支付完成'
                : '本次开通未完成'
          }}
        </h2>
        <span>{{ purchase.state.value.message }}</span>
        <dl>
          <dt>购卡单号</dt>
          <dd>{{ purchase.state.value.purchase.purchaseNo }}</dd>
          <dt>会员卡</dt>
          <dd>{{ purchase.state.value.purchase.levelName }}</dd>
          <dt>状态</dt>
          <dd>{{ purchase.state.value.purchase.status }}</dd>
        </dl>
      </section>
      <MembershipPurchasePanel
        :level="purchaseLevel"
        :capability="{
          action: 'purchase',
          allowed: false,
          label: '已创建',
          description: '购卡单已保存',
        }"
        :state="purchase.state.value"
        :submitting="purchase.submitting.value"
        :can-simulate-payment="purchase.canSimulatePayment.value"
        :is-production="isProduction"
        @simulate-payment="simulatePayment"
      />
      <button
        class="purchase-result__button"
        type="button"
        @click="router.push('/membership-cards')"
      >
        返回会员中心
      </button>
    </template>
  </StorePage>
</template>

<style scoped>
.purchase-result {
  display: grid;
  min-width: 0;
  gap: var(--mall-space-3);
}
.purchase-result__passport {
  padding: var(--mall-space-6) var(--mall-space-5);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-feature);
  background: linear-gradient(145deg, #f5faf3, #fff9f0);
  box-shadow: var(--mall-shadow-card);
  text-align: center;
}
.purchase-result__passport[data-kind='fulfilled'] {
  border-color: color-mix(in srgb, var(--mall-success) 42%, var(--mall-border));
}
.purchase-result__passport[data-kind='failed'] {
  border-color: color-mix(in srgb, var(--mall-danger) 42%, var(--mall-border));
}
.purchase-result__seal {
  display: grid;
  width: 54px;
  height: 54px;
  margin: 0 auto;
  place-items: center;
  border: 2px solid var(--mall-primary);
  border-radius: 50%;
  color: var(--mall-primary-strong);
  font-size: 24px;
  font-weight: 800;
}
.purchase-result__passport > p,
.purchase-result__passport h2,
.purchase-result__passport > span {
  margin: 0;
}
.purchase-result__passport > p {
  margin-top: var(--mall-space-3);
  color: var(--mall-accent);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.16em;
}
.purchase-result__passport h2 {
  margin-top: var(--mall-space-1);
  font-family: Georgia, 'Songti SC', serif;
  font-size: 21px;
}
.purchase-result__passport > span {
  display: block;
  margin-top: var(--mall-space-2);
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.6;
}
.purchase-result__passport dl {
  display: grid;
  margin: var(--mall-space-5) 0 0;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: var(--mall-space-2);
  text-align: left;
  font-size: 12px;
}
.purchase-result__passport dt {
  color: var(--mall-text-muted);
}
.purchase-result__passport dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.purchase-result__button {
  width: 100%;
  min-height: 46px;
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-control);
  background: var(--mall-surface);
  color: var(--mall-primary-strong);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
</style>
