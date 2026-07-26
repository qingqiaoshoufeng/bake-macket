<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';

import StoreStatePanel from '../../components/feedback/StoreStatePanel.vue';
import StorePage from '../../components/layout/StorePage.vue';
import StorePageHeader from '../../components/layout/StorePageHeader.vue';
import MembershipActivity from './components/MembershipActivity.vue';
import MembershipBenefits from './components/MembershipBenefits.vue';
import MembershipCardCarousel from './components/MembershipCardCarousel.vue';
import MembershipOverviewPanel from './components/MembershipOverviewPanel.vue';
import { MEMBERSHIP_COPY } from './config/copy.js';
import { hasMembershipCardContent } from './hooks/purchase-capability.js';
import { useMembershipCenter } from './hooks/useMembershipCenter.js';

const router = useRouter();
const center = useMembershipCenter();

async function load(): Promise<void> {
  try {
    await center.methods.load();
  } catch {
    showToast('会员中心加载失败');
  }
}

onMounted(() => void load());
</script>

<template>
  <StorePage compact class="membership-center">
    <StorePageHeader
      back
      :title="MEMBERSHIP_COPY.centerTitle"
      :eyebrow="MEMBERSHIP_COPY.centerEyebrow"
      :description="MEMBERSHIP_COPY.centerDescription"
      @back="router.push('/profile')"
    />
    <StoreStatePanel
      v-if="center.error.value"
      state="error"
      title="会员中心加载失败"
      :description="center.error.value"
    >
      <template #action>
        <button class="membership-center__retry" type="button" @click="load">
          重新加载
        </button>
      </template>
    </StoreStatePanel>
    <StoreStatePanel
      v-else-if="center.loading.value || !center.data.overview.value"
      state="loading"
      title="正在翻阅烘焙护照"
      description="马上呈现会员卡、余额和最近记录。"
    />
    <template v-else>
      <MembershipOverviewPanel :overview="center.data.overview.value" />
      <MembershipCardCarousel
        v-if="hasMembershipCardContent(center.data.overview.value)"
        :overview="center.data.overview.value"
        @open="router.push(`/membership-cards/${$event}`)"
      />
      <StoreStatePanel
        v-else
        state="empty"
        :title="MEMBERSHIP_COPY.emptyTitle"
        :description="MEMBERSHIP_COPY.emptyDescription"
      />
      <MembershipBenefits
        v-if="center.data.overview.value.currentMembership?.benefits.length"
        :benefits="center.data.overview.value.currentMembership.benefits"
        title="当前会员权益"
      />
      <MembershipActivity
        :purchases="center.data.purchases.value"
        :credit-entries="center.data.creditEntries.value"
      />
    </template>
  </StorePage>
</template>

<style scoped>
.membership-center {
  display: grid;
  min-width: 0;
  gap: var(--mall-space-3);
}
.membership-center__retry {
  min-height: 44px;
  padding: 0 var(--mall-space-5);
  border: 0;
  border-radius: var(--mall-radius-control);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
</style>
