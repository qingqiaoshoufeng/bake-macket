<script setup lang="ts">
import { useRouter } from 'vue-router';

import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import StorePage from '../components/layout/StorePage.vue';

const router = useRouter();

function backHome(): void {
  void router.replace('/');
}
</script>

<template>
  <StorePage class="not-found">
    <StoreStatePanel
      state="error"
      title="页面未找到"
      description="链接可能已失效,返回首页继续逛逛吧。"
    >
      <template #action>
        <button type="button" class="not-found__action" @click="backHome">
          返回首页
        </button>
      </template>
    </StoreStatePanel>
  </StorePage>
</template>

<style scoped>
.not-found {
  display: grid;
  min-height: 100%;
  place-items: center;
}

.not-found :deep(.store-state-panel) {
  width: 100%;
}

.not-found__action {
  min-height: 44px;
  padding: 0 var(--mall-space-5);
  border: 0;
  border-radius: var(--mall-radius-card);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
</style>
