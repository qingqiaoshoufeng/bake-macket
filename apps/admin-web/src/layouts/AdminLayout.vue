<script setup lang="ts">
import { ElButton, ElMenu, ElMenuItem, ElMenuItemGroup } from 'element-plus';
import { computed } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';

import { ADMIN_NAV_GROUPS } from '../config/navigation.js';
import { useAdminAuthStore } from '../stores/admin-auth.js';

const adminAuth = useAdminAuthStore();
const router = useRouter();
const route = useRoute();
const navItems = ADMIN_NAV_GROUPS.flatMap(({ items }) => items);

const layoutMode = computed(() => route.meta.layoutMode ?? 'document');
const activePath = computed(
  () =>
    navItems
      .map(({ path }) => path)
      .filter(
        (path) => route.path === path || route.path.startsWith(`${path}/`),
      )
      .sort((left, right) => right.length - left.length)[0] ?? route.path,
);
const pageTitle = computed(() => {
  const matchedTitle = [...route.matched]
    .reverse()
    .map((record) => record.meta.title)
    .find((title): title is string => typeof title === 'string');

  return (
    matchedTitle ??
    navItems.find(({ path }) => path === route.path)?.label ??
    '概览'
  );
});
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
  <div class="admin-layout" :class="`admin-layout--${layoutMode}`">
    <aside class="admin-layout__sidebar">
      <div class="admin-layout__brand">
        <span class="admin-layout__brand-mark" aria-hidden="true">烘</span>
        <div class="admin-layout__brand-text">
          <strong>店长小助手</strong>
          <small>BAKE MALL ADMIN</small>
        </div>
      </div>

      <nav
        class="admin-layout__nav"
        data-testid="admin-nav"
        aria-label="后台导航"
      >
        <ElMenu
          class="admin-layout__menu"
          :default-active="activePath"
          @select="(index) => onSelect(String(index))"
        >
          <ElMenuItemGroup
            v-for="group in ADMIN_NAV_GROUPS"
            :key="group.label"
            class="admin-layout__nav-group"
          >
            <template #title>
              <span class="admin-layout__nav-label">{{ group.label }}</span>
            </template>
            <ElMenuItem
              v-for="item in group.items"
              :key="item.path"
              :index="item.path"
              :aria-current="activePath === item.path ? 'page' : undefined"
            >
              <span
                class="admin-layout__nav-icon"
                :data-icon="item.icon"
                aria-hidden="true"
              ></span>
              <span>{{ item.label }}</span>
            </ElMenuItem>
          </ElMenuItemGroup>
        </ElMenu>
      </nav>

      <div class="admin-layout__sidebar-footer">
        <div class="admin-layout__sidebar-foot">
          <span aria-hidden="true">✦</span>
          <p>认真经营，也要记得休息</p>
        </div>
        <p class="admin-layout__sidebar-version">v0.1 · MVP</p>
      </div>
    </aside>

    <div class="admin-layout__main">
      <header class="admin-layout__topbar">
        <div>
          <small class="admin-layout__topbar-eyebrow">今日店务</small>
          <span
            class="admin-layout__topbar-title"
            data-testid="admin-page-title"
          >
            {{ pageTitle }}
          </span>
        </div>
        <div class="admin-layout__topbar-user">
          <span class="admin-layout__greeting">{{ greeting }}</span>
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
      <div
        class="admin-layout__narrow-warning"
        data-testid="admin-narrow-warning"
        role="status"
      >
        <span class="admin-layout__narrow-icon" aria-hidden="true">i</span>
        <p>建议使用 ≥ 1024px 宽度的桌面浏览器访问商家后台。</p>
      </div>
      <main class="admin-layout__canvas">
        <div class="admin-layout__content">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin-layout {
  display: grid;
  grid-template-columns: var(--admin-sidebar-width) minmax(0, 1fr);
  min-height: 100vh;
  background: var(--admin-canvas);
}

.admin-layout--workspace {
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}

.admin-layout__sidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
  height: 100vh;
  padding: 24px 18px;
  background:
    radial-gradient(circle at 20px 90%, rgb(121 101 184 / 8%), transparent 24%),
    var(--admin-sidebar);
  border-right: 1px solid var(--admin-border);
}

.admin-layout__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 6px;
}

.admin-layout__brand-mark {
  display: grid;
  flex: none;
  width: 42px;
  height: 42px;
  place-items: center;
  background: linear-gradient(145deg, #8c79c8, var(--admin-primary));
  border-radius: 14px;
  box-shadow: 0 8px 20px rgb(121 101 184 / 24%);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
}

.admin-layout__brand-text strong,
.admin-layout__brand-text small {
  display: block;
}

.admin-layout__brand-text strong {
  color: var(--admin-text);
  font-size: 16px;
  letter-spacing: 0.04em;
}

.admin-layout__brand-text small {
  margin-top: 3px;
  color: var(--admin-muted);
  font-size: 9px;
  letter-spacing: 0.13em;
}

.admin-layout__nav {
  min-height: 0;
  overflow-y: auto;
}

.admin-layout__menu {
  background: transparent;
  border-right: none;
}

.admin-layout__menu :deep(.el-menu-item-group + .el-menu-item-group) {
  margin-top: 18px;
}

.admin-layout__menu :deep(.el-menu-item-group__title) {
  padding: 0 12px 6px !important;
  line-height: 1.4;
}

.admin-layout__nav-label {
  color: #aaa4b5;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.admin-layout__menu :deep(.el-menu-item) {
  height: 44px;
  margin: 3px 0;
  padding: 0 12px !important;
  border-radius: 12px;
  color: var(--admin-muted);
  gap: 11px;
}

.admin-layout__menu :deep(.el-menu-item:hover) {
  background: var(--admin-surface-soft);
  color: var(--admin-primary);
}

.admin-layout__menu :deep(.el-menu-item.is-active) {
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  font-weight: 650;
}

.admin-layout__nav-icon {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 1.5px solid currentcolor;
  border-radius: 6px;
  opacity: 0.88;
}

.admin-layout__nav-icon[data-icon='overview'] {
  border-radius: 50% 50% 7px 7px;
}

.admin-layout__nav-icon[data-icon='category'] {
  box-shadow: inset 6px 0 0 transparent;
}

.admin-layout__nav-icon[data-icon='product'] {
  border-radius: 4px 4px 7px 7px;
  transform: rotate(-4deg);
}

.admin-layout__nav-icon[data-icon='banner'] {
  width: 19px;
  height: 15px;
  border-radius: 4px;
}

.admin-layout__nav-icon[data-icon='order'] {
  border-radius: 3px 3px 7px 7px;
}

.admin-layout__nav-icon[data-icon='membership'] {
  border-radius: 9px 4px 9px 4px;
  box-shadow: inset 0 0 0 3px transparent;
  transform: rotate(-3deg);
}

.admin-layout__nav-icon[data-icon='membership-purchase'] {
  border-radius: 4px;
  box-shadow: inset 0 -5px 0 transparent;
  transform: rotate(2deg);
}

.admin-layout__sidebar-footer {
  display: grid;
  gap: 8px;
  margin-top: auto;
}

.admin-layout__sidebar-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--admin-surface-soft);
  border-radius: 13px;
  color: var(--admin-muted);
  font-size: 11px;
}

.admin-layout__sidebar-foot span {
  color: var(--admin-pink);
}

.admin-layout__sidebar-foot p {
  margin: 0;
}

.admin-layout__sidebar-version {
  margin: 0;
  color: #aaa4b5;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-align: center;
}

.admin-layout__main {
  display: flex;
  min-width: 0;
  min-height: 100vh;
  flex-direction: column;
}

.admin-layout--workspace .admin-layout__main {
  display: grid;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.admin-layout--workspace .admin-layout__canvas,
.admin-layout--workspace .admin-layout__content {
  min-height: 0;
  overflow: hidden;
}

.admin-layout--workspace .admin-layout__content {
  height: 100%;
}

.admin-layout__topbar {
  position: sticky;
  z-index: 10;
  top: 0;
  display: flex;
  min-height: var(--admin-topbar-height);
  align-items: center;
  justify-content: space-between;
  padding: 10px 28px;
  background: rgb(255 255 255 / 88%);
  border-bottom: 1px solid var(--admin-border);
  backdrop-filter: blur(14px);
}

.admin-layout__topbar > div:first-child {
  display: grid;
  gap: 2px;
}

.admin-layout__topbar-eyebrow {
  color: var(--admin-muted);
  font-size: 10px;
  letter-spacing: 0.12em;
}

.admin-layout__topbar-title {
  color: var(--admin-text);
  font-size: 16px;
  font-weight: 650;
}

.admin-layout__topbar-user {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--admin-muted);
  font-size: 13px;
}

.admin-layout__greeting {
  padding: 7px 11px;
  background: var(--admin-surface-soft);
  border-radius: 999px;
}

.admin-layout__canvas {
  flex: 1;
  background:
    radial-gradient(circle at 86% 8%, rgb(233 139 172 / 8%), transparent 22%),
    radial-gradient(circle at 10% 95%, rgb(120 170 149 / 8%), transparent 20%),
    var(--admin-canvas);
}

.admin-layout__content {
  width: min(100%, calc(var(--admin-content-max) + 56px));
  min-height: 100%;
  margin: 0 auto;
  padding: 28px;
}

.admin-layout__narrow-warning {
  display: none;
}

@media (max-width: 1023px) {
  .admin-layout--workspace .admin-layout__main {
    grid-template-rows: auto auto minmax(0, 1fr);
  }

  .admin-layout__narrow-warning {
    position: sticky;
    z-index: 9;
    top: var(--admin-topbar-height);
    display: flex;
    min-height: 40px;
    align-items: center;
    gap: 8px;
    padding: 8px 28px;
    background: #fff9fb;
    border-bottom: 1px solid rgb(180 63 102 / 16%);
    color: var(--admin-danger);
    font-size: 12px;
  }

  .admin-layout__narrow-warning p {
    margin: 0;
  }

  .admin-layout__narrow-icon {
    display: grid;
    flex: none;
    width: 18px;
    height: 18px;
    place-items: center;
    border: 1px solid currentcolor;
    border-radius: 50%;
    font-size: 11px;
    font-style: normal;
  }
}

@media (max-width: 720px) {
  .admin-layout {
    grid-template-columns: 1fr;
  }

  .admin-layout__sidebar {
    display: none;
  }

  .admin-layout__topbar {
    padding-inline: 16px;
  }

  .admin-layout__greeting {
    display: none;
  }

  .admin-layout__content {
    padding: 18px 16px;
  }

  .admin-layout__narrow-warning {
    padding-inline: 16px;
  }
}
</style>
