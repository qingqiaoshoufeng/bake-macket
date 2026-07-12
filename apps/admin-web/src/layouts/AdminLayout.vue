<script setup lang="ts">
import { computed } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { ElButton, ElIcon, ElMenu, ElMenuItem } from 'element-plus';

import { useAdminAuthStore } from '../stores/admin-auth.js';

interface NavItem {
  readonly path: string;
  readonly label: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { path: '/dashboard', label: '概览' },
  { path: '/categories', label: '分类' },
  { path: '/products', label: '商品' },
  { path: '/banners', label: 'Banner' },
  { path: '/orders', label: '订单' },
];

const adminAuth = useAdminAuthStore();
const router = useRouter();
const route = useRoute();

const activePath = computed(() => route.path);
const greeting = computed(() => {
  const name = adminAuth.profile?.displayName;
  if (name) return `你好,${name}`;
  const email = adminAuth.profile?.email;
  return email ? `你好,${email}` : '你好,管理员';
});

async function onLogout(): Promise<void> {
  adminAuth.clearSession();
  await router.replace('/login');
}

async function onSelect(path: string): Promise<void> {
  if (route.path !== path) {
    await router.push(path);
  }
}
</script>

<template>
  <div class="admin-layout">
    <aside class="admin-layout__sidebar">
      <div class="admin-layout__brand">
        <span class="admin-layout__brand-mark">烘</span>
        <div class="admin-layout__brand-text">
          <strong>烘焙商城后台</strong>
          <small>Merchant Admin</small>
        </div>
      </div>
      <ElMenu
        class="admin-layout__menu"
        :default-active="activePath"
        @select="(index) => onSelect(String(index))"
      >
        <ElMenuItem
          v-for="item in NAV_ITEMS"
          :key="item.path"
          :index="item.path"
        >
          <span>{{ item.label }}</span>
        </ElMenuItem>
      </ElMenu>
      <p class="admin-layout__sidebar-foot">v0.1 · MVP</p>
    </aside>

    <div class="admin-layout__main">
      <header class="admin-layout__topbar">
        <span class="admin-layout__topbar-title">{{
          NAV_ITEMS.find((item) => item.path === activePath)?.label ?? '概览'
        }}</span>
        <div class="admin-layout__topbar-user">
          <span>{{ greeting }}</span>
          <ElButton
            type="primary"
            plain
            size="small"
            data-testid="admin-logout"
            @click="onLogout"
          >
            退出登录
          </ElButton>
        </div>
      </header>
      <main class="admin-layout__content">
        <RouterView />
      </main>
    </div>

    <div class="admin-layout__narrow-warning" role="status">
      <ElIcon class="admin-layout__narrow-icon" :size="20" />
      <p>建议使用 ≥ 1024px 宽度的桌面浏览器访问商家后台。</p>
    </div>
  </div>
</template>

<style scoped>
.admin-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
  background: #f6f4fb;
}

.admin-layout__sidebar {
  background: linear-gradient(180deg, #ffffff 0%, var(--admin-lilac) 100%);
  border-right: 1px solid #ece6f7;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.admin-layout__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.admin-layout__brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--el-color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 18px;
  box-shadow: 0 4px 12px rgba(123, 97, 200, 0.35);
}

.admin-layout__brand-text strong {
  display: block;
  color: #2f2a3d;
  font-size: 15px;
}

.admin-layout__brand-text small {
  color: #8a83a3;
  font-size: 11px;
  letter-spacing: 1px;
}

.admin-layout__menu {
  background: transparent;
  border-right: none;
}

.admin-layout__sidebar-foot {
  margin: auto 0 0;
  text-align: center;
  color: #b6aecf;
  font-size: 11px;
}

.admin-layout__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.admin-layout__topbar {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid #ece6f7;
}

.admin-layout__topbar-title {
  color: #2f2a3d;
  font-weight: 600;
  font-size: 16px;
}

.admin-layout__topbar-user {
  display: flex;
  align-items: center;
  gap: 16px;
  color: #5f5980;
  font-size: 14px;
}

.admin-layout__content {
  flex: 1;
  padding: 24px;
  overflow: auto;
}

.admin-layout__narrow-warning {
  display: none;
}

@media (max-width: 720px) {
  .admin-layout {
    grid-template-columns: 1fr;
  }
  .admin-layout__sidebar {
    display: none;
  }
  .admin-layout__narrow-warning {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: #fff5fa;
    color: var(--admin-pink);
    border-bottom: 1px solid #f5d6e5;
  }
}
</style>
