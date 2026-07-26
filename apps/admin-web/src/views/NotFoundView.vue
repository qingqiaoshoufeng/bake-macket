<script setup lang="ts">
import { useRouter } from 'vue-router';
import { ElButton } from 'element-plus';

import AdminEmptyState from '../components/feedback/AdminEmptyState.vue';

const router = useRouter();

function goHome(): void {
  void router.replace('/dashboard');
}
</script>

<template>
  <section class="admin-state-page">
    <AdminEmptyState
      title="页面走丢了"
      description="这个地址暂时没有对应内容，请检查链接或返回经营概览继续工作。"
      tone="pink"
    >
      <template #action>
        <ElButton type="primary" data-testid="not-found-home" @click="goHome">
          返回经营概览
        </ElButton>
      </template>
    </AdminEmptyState>
  </section>
</template>

<style scoped>
.admin-state-page {
  display: grid;
  min-height: calc(100vh - var(--admin-topbar-height) - 64px);
  place-items: center;
  padding: 24px;
}

.admin-state-page :deep(.admin-empty-state) {
  width: min(100%, 620px);
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-feature);
  box-shadow: var(--admin-shadow-card);
}
</style>
