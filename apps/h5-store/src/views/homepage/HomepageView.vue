<script setup lang="ts">
import type { HomepageLink } from '@bake-mall/contracts';
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

import StorePage from '../../components/layout/StorePage.vue';
import StoreStatePanel from '../../components/feedback/StoreStatePanel.vue';
import HomepageRenderer from './components/HomepageRenderer.vue';
import { homepageLinkPath } from './config/navigation.js';
import { useHomepage } from './hooks/useHomepage.js';

const router = useRouter();
const homepage = useHomepage();

async function load(): Promise<void> {
  try {
    await homepage.load();
  } catch {
    // 错误态在页面内显示并提供显式重试。
  }
}

function navigate(link: HomepageLink): void {
  const path = homepageLinkPath(link);
  if (path) void router.push(path);
}

onMounted(load);
</script>

<template>
  <StorePage full-bleed with-tabbar class="homepage-view">
    <StoreStatePanel
      v-if="homepage.loading.value && !homepage.loaded.value"
      class="homepage-view__state"
      state="loading"
      title="正在准备首页"
      description="新鲜内容马上就来。"
    />
    <StoreStatePanel
      v-else-if="homepage.error.value"
      class="homepage-view__state"
      state="error"
      title="首页加载失败"
      :description="homepage.error.value"
    >
      <template #action>
        <button type="button" class="homepage-view__action" @click="load">
          重新加载
        </button>
      </template>
    </StoreStatePanel>
    <StoreStatePanel
      v-else-if="!homepage.data.value"
      class="homepage-view__state"
      state="empty"
      title="首页正在准备中"
      description="可以先去商品页挑选今天的烘焙。"
    >
      <template #action>
        <button
          type="button"
          class="homepage-view__action"
          @click="router.push('/products')"
        >
          去商品页
        </button>
      </template>
    </StoreStatePanel>
    <HomepageRenderer
      v-else
      :config="homepage.data.value.config"
      @navigate="navigate"
    />
  </StorePage>
</template>

<style scoped>
.homepage-view {
  overflow-x: hidden;
}

.homepage-view__state {
  margin: var(--mall-space-8) var(--mall-page-gutter);
}

.homepage-view__action {
  min-height: 44px;
  padding: 0 var(--mall-space-5);
  border: 0;
  border-radius: var(--mall-radius-card);
  background: var(--mall-primary);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}
</style>
