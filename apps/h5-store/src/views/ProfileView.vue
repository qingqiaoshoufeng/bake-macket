<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';

import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import StorePage from '../components/layout/StorePage.vue';
import StorePageHeader from '../components/layout/StorePageHeader.vue';
import MembershipCardCarousel from './membership/components/MembershipCardCarousel.vue';
import { hasMembershipCardContent } from './membership/hooks/purchase-capability.js';
import { useMembershipOverview } from './membership/hooks/useMembershipOverview.js';
import {
  ProfileAccountInfo,
  ProfileIdentityCard,
  ProfileLogoutButton,
  ProfileServiceLinks,
  useProfile,
} from './profile/index.js';

const router = useRouter();
const profile = useProfile();
const membership = useMembershipOverview();

async function loadProfile(): Promise<void> {
  try {
    await profile.methods.load();
  } catch {
    showToast('资料加载失败');
  }
}

async function loadMembership(): Promise<void> {
  try {
    await membership.methods.load();
  } catch {
    // 会员区自行显示错误，不影响身份和原有功能。
  }
}

onMounted(() => {
  void Promise.allSettled([loadProfile(), loadMembership()]);
});

function navigate(path: string): void {
  void router.push(path);
}

async function logout(): Promise<void> {
  profile.methods.logout();
  showToast({ type: 'success', message: '已退出登录' });
  await router.replace('/login?redirect=%2Fprofile');
}
</script>

<template>
  <StorePage with-tabbar class="profile">
    <StorePageHeader
      title="个人中心"
      eyebrow="MY BAKE ACCOUNT"
      description="查看账号资料与常用服务。"
    />
    <ProfileIdentityCard :profile="profile.data.profile.value" />
    <section class="profile__membership" aria-label="会员资产">
      <StoreStatePanel
        v-if="membership.error.value"
        state="error"
        title="会员资产加载失败"
        :description="membership.error.value"
      >
        <template #action>
          <button
            type="button"
            class="profile__retry"
            data-testid="membership-retry"
            @click="loadMembership"
          >
            重新加载会员资产
          </button>
        </template>
      </StoreStatePanel>
      <StoreStatePanel
        v-else-if="membership.loading.value"
        state="loading"
        title="正在整理烘焙护照"
        description="账号信息仍可正常查看。"
      />
      <MembershipCardCarousel
        v-else-if="
          membership.data.overview.value &&
          hasMembershipCardContent(membership.data.overview.value)
        "
        :overview="membership.data.overview.value"
        @open="navigate(`/membership-cards/${$event}`)"
      />
      <StoreStatePanel
        v-else
        state="empty"
        title="会员服务准备中"
        description="新的烘焙护照正在制作。"
      />
    </section>
    <ProfileAccountInfo :profile="profile.data.profile.value" />
    <ProfileServiceLinks @navigate="navigate" />
    <ProfileLogoutButton @logout="logout" />
    <StoreStatePanel
      v-if="profile.loading.value && !profile.data.profile.value"
      state="loading"
      title="正在加载资料"
      description="马上为你整理好账号信息。"
    />
  </StorePage>
</template>

<style scoped>
.profile {
  display: grid;
  min-width: 0;
  gap: var(--mall-space-3);
}
.profile__membership {
  min-width: 0;
}
.profile__membership :deep(.store-state-panel) {
  min-height: 190px;
}
.profile__retry {
  min-height: 44px;
  padding: 0 var(--mall-space-4);
  border: 0;
  border-radius: var(--mall-radius-control);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.profile__retry:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--mall-accent) 50%, transparent);
  outline-offset: 2px;
}
</style>
