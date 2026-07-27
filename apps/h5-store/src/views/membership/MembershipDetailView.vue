<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';

import StoreStatePanel from '../../components/feedback/StoreStatePanel.vue';
import StorePage from '../../components/layout/StorePage.vue';
import StorePageHeader from '../../components/layout/StorePageHeader.vue';
import MembershipBenefits from './components/MembershipBenefits.vue';
import MembershipCard from './components/MembershipCard.vue';
import MembershipPurchasePanel from './components/MembershipPurchasePanel.vue';
import { useMembershipDetail } from './hooks/useMembershipDetail.js';
import { useMembershipPurchase } from './hooks/useMembershipPurchase.js';

const route = useRoute();
const router = useRouter();
const detail = useMembershipDetail();
const purchase = useMembershipPurchase();
const isProduction = import.meta.env.PROD;
const cardItem = computed(() =>
  detail.data.level.value && detail.capability.value
    ? {
        level: detail.data.level.value,
        capability: detail.capability.value,
        purchasable: true,
        isCurrent:
          detail.data.overview.value?.currentMembership?.rank ===
          detail.data.level.value.rank,
      }
    : null,
);

async function load(id: string): Promise<void> {
  try {
    await detail.methods.load(id);
    await purchase.methods.refreshOverview();
  } catch {
    showToast('会员卡加载失败');
  }
}

function loadRouteLevel(id: unknown): void {
  if (typeof id === 'string' && id) void load(id);
}

async function createPurchase(): Promise<void> {
  const level = detail.data.level.value;
  if (isProduction || !level || !detail.capability.value?.allowed) return;
  try {
    const created = await purchase.methods.create(level.id);
    await router.push(`/membership-purchases/${created.id}`);
  } catch {
    showToast('创建购卡单失败，请重试');
  }
}

onMounted(() => loadRouteLevel(route.params.id));
watch(() => route.params.id, loadRouteLevel);
</script>

<template>
  <StorePage compact class="membership-detail">
    <StorePageHeader
      back
      title="护照详情"
      eyebrow="PASSPORT DETAILS"
      description="确认等级、权益与购卡规则。"
      @back="router.push('/membership-cards')"
    />
    <StoreStatePanel
      v-if="detail.error.value"
      state="error"
      title="会员卡加载失败"
      :description="detail.error.value"
    >
      <template #action>
        <button
          class="membership-detail__retry"
          type="button"
          @click="loadRouteLevel(route.params.id)"
        >
          重新加载
        </button>
      </template>
    </StoreStatePanel>
    <StoreStatePanel
      v-else-if="
        detail.loading.value || !cardItem || !detail.data.overview.value
      "
      state="loading"
      title="正在打开护照"
      description="正在核对会员等级与购买资格。"
    />
    <template v-else>
      <MembershipCard
        :item="cardItem"
        :available-credit-cents="
          detail.data.overview.value.account.availableCreditCents
        "
        :ends-at="
          cardItem.isCurrent
            ? detail.data.overview.value.currentMembership?.endsAt
            : undefined
        "
      />
      <MembershipBenefits
        :benefits="cardItem.level.benefits"
        title="完整会员权益"
      />
      <section class="membership-detail__rules">
        <h2>购卡规则</h2>
        <p>
          同级购买将续费并延长当前有效期；更高等级立即升级；当前等级更高时不可降购。
        </p>
      </section>
      <MembershipPurchasePanel
        :level="cardItem.level"
        :capability="cardItem.capability"
        :state="purchase.state.value"
        :submitting="purchase.submitting.value"
        :can-simulate-payment="purchase.canSimulatePayment.value"
        :is-production="isProduction"
        @purchase="createPurchase"
      />
    </template>
  </StorePage>
</template>

<style scoped>
.membership-detail {
  display: grid;
  min-width: 0;
  gap: var(--mall-space-3);
}
.membership-detail__rules {
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface-soft);
}
.membership-detail__rules h2,
.membership-detail__rules p {
  margin: 0;
}
.membership-detail__rules h2 {
  font-size: 15px;
}
.membership-detail__rules p {
  margin-top: var(--mall-space-2);
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.7;
}
.membership-detail__retry {
  min-height: 44px;
  padding: 0 var(--mall-space-5);
  border: 0;
  border-radius: var(--mall-radius-control);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-weight: 800;
}
</style>
