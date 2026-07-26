<script setup lang="ts">
import type { UserProfileView } from '@bake-mall/contracts';

import { PROFILE_LINKS } from '../config/links.js';

defineProps<{ profile: UserProfileView | null }>();
defineEmits<{
  (event: 'navigate', path: string): void;
  (event: 'logout'): void;
}>();
</script>

<template>
  <section class="profile__hero">
    <div class="profile__avatar" aria-hidden="true">
      {{
        profile?.nickname ? profile.nickname.slice(0, 1).toUpperCase() : '客'
      }}
    </div>
    <div class="profile__identity">
      <h2>{{ profile?.nickname ?? '游客' }}</h2>
      <p v-if="profile?.phone" class="profile__phone">{{ profile.phone }}</p>
      <p v-else class="profile__phone profile__phone--missing">未绑定手机号</p>
    </div>
  </section>
  <section class="profile__section">
    <h2>账号信息</h2>
    <dl>
      <dt>昵称</dt>
      <dd>{{ profile?.nickname ?? '—' }}</dd>
      <dt>手机号</dt>
      <dd>{{ profile?.phone ?? '未绑定' }}</dd>
      <dt>用户 ID</dt>
      <dd class="profile__id">{{ profile?.id ?? '—' }}</dd>
    </dl>
    <p class="profile__hint">
      头像与昵称为微信账号绑定信息,首期暂不支持在 H5 修改。
    </p>
  </section>
  <nav class="profile__links" aria-label="个人功能">
    <button
      v-for="link in PROFILE_LINKS"
      :key="link.path"
      type="button"
      @click="$emit('navigate', link.path)"
    >
      <span>{{ link.label }}</span
      ><span aria-hidden="true">›</span>
    </button>
  </nav>
  <button
    type="button"
    class="profile__logout"
    data-testid="logout"
    @click="$emit('logout')"
  >
    退出登录
  </button>
</template>

<style scoped>
.profile__hero {
  display: flex;
  padding: var(--mall-space-5);
  align-items: center;
  gap: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-feature);
  background: linear-gradient(
    135deg,
    var(--mall-surface-soft),
    var(--mall-surface)
  );
  box-shadow: var(--mall-shadow-card);
}
.profile__avatar {
  display: grid;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  place-items: center;
  border: 4px solid rgb(255 255 255 / 78%);
  border-radius: 50%;
  background: var(--mall-primary);
  color: #fff;
  font-size: 25px;
  font-weight: 700;
  box-shadow: var(--mall-shadow-card);
}
.profile__identity {
  min-width: 0;
}
.profile__identity h2 {
  margin: 0;
  overflow: hidden;
  color: var(--mall-text);
  font-size: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile__phone {
  margin: var(--mall-space-1) 0 0;
  color: var(--mall-text-muted);
  font-size: 13px;
}
.profile__phone--missing {
  color: var(--mall-accent);
}
.profile__section,
.profile__links {
  margin-top: var(--mall-space-3);
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.profile__section h2 {
  margin: 0 0 var(--mall-space-3);
  color: var(--mall-primary-strong);
  font-size: 14px;
}
.profile__section dl {
  display: grid;
  margin: 0;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: var(--mall-space-2) var(--mall-space-3);
  font-size: 14px;
}
.profile__section dt {
  color: var(--mall-text-muted);
}
.profile__section dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--mall-text);
}
.profile__id {
  color: var(--mall-text-muted) !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.profile__hint {
  margin: var(--mall-space-3) 0 0;
  padding-top: var(--mall-space-3);
  border-top: 1px dashed var(--mall-border);
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.6;
}
.profile__links {
  display: grid;
  padding-block: var(--mall-space-1);
}
.profile__links button {
  display: flex;
  min-height: 52px;
  padding: 0 var(--mall-space-2);
  align-items: center;
  justify-content: space-between;
  border: 0;
  border-bottom: 1px solid var(--mall-border);
  background: transparent;
  color: var(--mall-text);
  font: inherit;
  cursor: pointer;
}
.profile__links button:last-child {
  border-bottom: 0;
}
.profile__links button span:last-child {
  color: var(--mall-primary-strong);
  font-size: 24px;
}
.profile__logout {
  width: 100%;
  min-height: 48px;
  margin-top: var(--mall-space-3);
  border: 1px solid
    color-mix(in srgb, var(--mall-danger) 35%, var(--mall-border));
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  color: var(--mall-danger);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
</style>
