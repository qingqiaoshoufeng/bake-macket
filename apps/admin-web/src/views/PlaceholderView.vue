<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

interface PlaceholderMeta {
  readonly title: string;
  readonly description: string;
}

const PLACEHOLDERS: Readonly<Record<string, PlaceholderMeta>> = {
  '/categories': {
    title: '分类管理',
    description:
      '单层分类:名称、图标 / 图片、排序、启用状态。Task 12 将引入完整的 CRUD。',
  },
  '/products': {
    title: '商品 & SKU 管理',
    description:
      '名称、简介、分类、主图、轮播图、富文本详情、规格 SKU、独立价格与库存。Task 12 接入。',
  },
  '/banners': {
    title: 'Banner 管理',
    description:
      '首页与活动 Banner 的图片、标题、跳转目标与上下架。Task 12 接入。',
  },
  '/orders': {
    title: '订单管理',
    description:
      '查看订单、合法状态流转、备注查看 —— 不修改历史订单快照。Task 12 接入。',
  },
};

const route = useRoute();

const meta = computed<PlaceholderMeta>(() => {
  return (
    PLACEHOLDERS[route.path] ?? {
      title: '敬请期待',
      description: '此页面将在后续任务中实装。',
    }
  );
});
</script>

<template>
  <section class="placeholder">
    <div class="placeholder__card">
      <span class="placeholder__badge">占位</span>
      <h1>{{ meta.title }}</h1>
      <p>{{ meta.description }}</p>
    </div>
  </section>
</template>

<style scoped>
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.placeholder__card {
  background: #fff;
  border: 1px dashed #d4c7ec;
  border-radius: 16px;
  padding: 32px 36px;
  max-width: 480px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.placeholder__badge {
  align-self: center;
  background: var(--admin-lilac);
  color: #5e3fb2;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 500;
}

.placeholder__card h1 {
  margin: 0;
  font-size: 22px;
  color: #2f2a3d;
}

.placeholder__card p {
  margin: 0;
  color: #6f5d80;
  font-size: 14px;
  line-height: 1.6;
}
</style>
