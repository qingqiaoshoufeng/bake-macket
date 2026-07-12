<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

interface StatCard {
  readonly key: 'categories' | 'products' | 'banners' | 'orders';
  readonly title: string;
  readonly description: string;
  readonly accent: 'lilac' | 'pink' | 'success';
  readonly route: string;
  readonly cta: string;
}

/**
 * Placeholder stat tiles. Real KPI fetches (categories count, products
 * needing stock, orders awaiting action, banners expiring soon) arrive in
 * Task 12 once the catalog/order APIs are stitched into the admin surface.
 */
const STATS: readonly StatCard[] = [
  {
    key: 'orders',
    title: '待处理订单',
    description: '实时盘点 NEW / PROCESSING 订单状态',
    accent: 'pink',
    route: '/orders',
    cta: '进入订单',
  },
  {
    key: 'products',
    title: '商品 & SKU',
    description: '维护商品信息、规格与库存',
    accent: 'lilac',
    route: '/products',
    cta: '管理商品',
  },
  {
    key: 'categories',
    title: '分类',
    description: '单层分类:名称、图标、排序',
    accent: 'lilac',
    route: '/categories',
    cta: '管理分类',
  },
  {
    key: 'banners',
    title: 'Banner',
    description: '首页与活动 Banner 上 / 下架',
    accent: 'success',
    route: '/banners',
    cta: '管理 Banner',
  },
];

const hero = {
  greeting: '欢迎回来',
  subtitle: '今日的店铺总览将出现在这里,Ta 将随 Task 12 的接入逐步完善。',
};

const accentClass = (accent: StatCard['accent']) =>
  `dashboard__stat--${accent}`;
const goTo = (path: string) => router.push(path);
const pendingChips = computed(() => [
  { label: '新订单 NEW', tone: 'pink' },
  { label: '处理中 PROCESSING', tone: 'lilac' },
  { label: '已完成 COMPLETED', tone: 'success' },
]);
</script>

<template>
  <section class="dashboard">
    <header class="dashboard__hero">
      <h1>{{ hero.greeting }}</h1>
      <p>{{ hero.subtitle }}</p>
      <ul class="dashboard__chips" aria-label="订单状态色彩约定">
        <li
          v-for="chip in pendingChips"
          :key="chip.label"
          :class="['dashboard__chip', `dashboard__chip--${chip.tone}`]"
        >
          {{ chip.label }}
        </li>
      </ul>
    </header>

    <div class="dashboard__grid">
      <article
        v-for="card in STATS"
        :key="card.key"
        :class="['dashboard__stat', accentClass(card.accent)]"
      >
        <header class="dashboard__stat-head">
          <span class="dashboard__stat-dot" aria-hidden="true"></span>
          <h2>{{ card.title }}</h2>
        </header>
        <p class="dashboard__stat-desc">{{ card.description }}</p>
        <button
          type="button"
          class="dashboard__stat-cta"
          @click="goTo(card.route)"
        >
          {{ card.cta }} →
        </button>
      </article>
    </div>

    <aside class="dashboard__note" aria-label="占位说明">
      <strong>占位提示</strong>
      <p>
        当前 dashboard 为 Task 11 外壳,所有数字均为占位。Task 12 将引入
        <code>useAdminStatsStore</code> 与 catalog / banner / order 接口,
        为每个卡片填充真实数据。
      </p>
    </aside>
  </section>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.dashboard__hero h1 {
  margin: 0;
  font-size: 24px;
  color: #2f2a3d;
}

.dashboard__hero p {
  margin: 6px 0 12px;
  color: #6f5d80;
}

.dashboard__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.dashboard__chip {
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
}

.dashboard__chip--pink {
  background: #ffe1ec;
  color: #c44575;
}

.dashboard__chip--lilac {
  background: var(--admin-lilac);
  color: #5e3fb2;
}

.dashboard__chip--success {
  background: #e1f1e8;
  color: #2f6c52;
}

.dashboard__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.dashboard__stat {
  background: #fff;
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 6px 20px rgba(123, 97, 200, 0.08);
  border: 1px solid #ece6f7;
}

.dashboard__stat--lilac {
  border-top: 4px solid var(--el-color-primary);
}

.dashboard__stat--pink {
  border-top: 4px solid var(--admin-pink);
}

.dashboard__stat--success {
  border-top: 4px solid var(--el-color-success);
}

.dashboard__stat-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dashboard__stat-head h2 {
  margin: 0;
  font-size: 16px;
  color: #2f2a3d;
}

.dashboard__stat-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--el-color-primary);
}

.dashboard__stat--pink .dashboard__stat-dot {
  background: var(--admin-pink);
}

.dashboard__stat--success .dashboard__stat-dot {
  background: var(--el-color-success);
}

.dashboard__stat-desc {
  margin: 0;
  color: #6f5d80;
  font-size: 13px;
  min-height: 38px;
}

.dashboard__stat-cta {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  cursor: pointer;
  padding: 0;
  font-size: 13px;
  font-weight: 500;
}

.dashboard__note {
  background: #fff;
  border: 1px dashed #d4c7ec;
  border-radius: 12px;
  padding: 16px 18px;
  color: #5f5980;
  font-size: 13px;
}

.dashboard__note strong {
  display: block;
  color: #5e3fb2;
  margin-bottom: 4px;
}

.dashboard__note code {
  background: var(--admin-lilac);
  padding: 1px 6px;
  border-radius: 4px;
  color: #4a2f8c;
  font-size: 12px;
}
</style>
