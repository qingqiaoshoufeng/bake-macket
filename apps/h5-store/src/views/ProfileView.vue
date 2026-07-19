<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';

import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import StorePage from '../components/layout/StorePage.vue';
import StorePageHeader from '../components/layout/StorePageHeader.vue';
import StoreTabbar from './catalog/components/StoreTabbar.vue';
import { ProfileSummary, useProfile } from './profile/index.js';

const route = useRoute();
const router = useRouter();
const profile = useProfile();

onMounted(async () => {
  try {
    await profile.methods.load();
  } catch {
    showToast('资料加载失败');
  }
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
    <ProfileSummary
      :profile="profile.data.profile.value"
      @navigate="navigate"
      @logout="logout"
    />
    <StoreStatePanel
      v-if="profile.loading.value"
      state="loading"
      title="正在加载资料"
      description="马上为你整理好账号信息。"
    />
    <StoreTabbar :active-path="route.path" @navigate="navigate" />
  </StorePage>
</template>
