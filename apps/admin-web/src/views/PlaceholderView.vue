<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElButton } from 'element-plus';

import AdminEmptyState from '../components/feedback/AdminEmptyState.vue';
import AdminPage from '../components/layout/AdminPage.vue';

interface PlaceholderMeta {
  readonly title: string;
  readonly description: string;
}

const PLACEHOLDERS: Readonly<Record<string, PlaceholderMeta>> = {
  '/categories': {
    title: '分类管理正在准备中',
    description: '这里将用于维护商品分类、图片、排序与启用状态。',
  },
  '/products': {
    title: '商品管理正在准备中',
    description: '这里将用于维护商品内容、规格 SKU、价格与库存。',
  },
  '/banners': {
    title: 'Banner 管理正在准备中',
    description: '这里将用于维护首页横幅、跳转目标与展示顺序。',
  },
  '/orders': {
    title: '订单管理正在准备中',
    description: '这里将用于查看订单快照并执行合法的状态流转。',
  },
};

const route = useRoute();
const router = useRouter();
const meta = computed<PlaceholderMeta>(
  () =>
    PLACEHOLDERS[route.path] ?? {
      title: '功能正在准备中',
      description: '这个入口尚未开放，请先返回经营概览使用已有功能。',
    },
);

function goHome(): void {
  void router.push('/dashboard');
}
</script>

<template>
  <AdminPage>
    <section class="admin-placeholder-page">
      <AdminEmptyState :title="meta.title" :description="meta.description">
        <template #action>
          <ElButton
            type="primary"
            plain
            data-testid="placeholder-home"
            @click="goHome"
          >
            返回经营概览
          </ElButton>
        </template>
      </AdminEmptyState>
    </section>
  </AdminPage>
</template>

<style scoped>
.admin-placeholder-page {
  display: grid;
  min-height: 60vh;
  place-items: center;
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-feature);
  box-shadow: var(--admin-shadow-card);
}
</style>
