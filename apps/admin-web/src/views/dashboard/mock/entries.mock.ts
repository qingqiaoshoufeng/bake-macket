import type { DashboardEntry } from '../type/index.js';

export const DASHBOARD_ENTRY_PREVIEW: readonly DashboardEntry[] = [
  {
    key: 'orders',
    title: '订单履约',
    description: '查看新订单，推进制作并确认完成。',
    route: '/orders',
    cta: '处理订单',
    icon: '单',
    tone: 'pink',
  },
  {
    key: 'products',
    title: '商品与 SKU',
    description: '维护商品内容、规格、价格与库存。',
    route: '/products',
    cta: '管理商品',
    icon: '品',
    tone: 'lilac',
  },
  {
    key: 'categories',
    title: '商品分类',
    description: '整理商城分类、图片、排序与启用状态。',
    route: '/categories',
    cta: '管理分类',
    icon: '类',
    tone: 'mint',
  },
  {
    key: 'banners',
    title: '首页 Banner',
    description: '管理首页横幅、跳转目标与展示顺序。',
    route: '/banners',
    cta: '管理 Banner',
    icon: '图',
    tone: 'yellow',
  },
];
