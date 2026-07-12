<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import type { UserProfileView } from '@bake-mall/contracts';

import { customerApi, type MeView } from '../api/customer.js';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();

const profile = ref<UserProfileView | null>(auth.profile ?? null);
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    const view: MeView = await customerApi.getMe();
    profile.value = {
      id: view.id,
      nickname: view.nickname,
      avatarUrl: view.avatarUrl,
      phone: view.phone ?? undefined,
      phoneVerified: Boolean(auth.profile?.phoneVerified),
    };
  } catch {
    showToast('资料加载失败');
  } finally {
    loading.value = false;
  }
});

async function onLogout(): Promise<void> {
  auth.clearSession();
  showToast({ type: 'success', message: '已退出登录' });
  await router.replace('/login?redirect=%2Fprofile');
}
</script>

<template>
  <main class="profile">
    <header class="profile__hero">
      <div class="profile__avatar" aria-hidden="true">
        {{
          profile?.nickname ? profile.nickname.slice(0, 1).toUpperCase() : '客'
        }}
      </div>
      <h1>{{ profile?.nickname ?? '游客' }}</h1>
      <p v-if="profile?.phone" class="profile__phone">
        {{ profile.phone }}
      </p>
      <p v-else class="profile__phone profile__phone--missing">未绑定手机号</p>
    </header>

    <p v-if="loading" class="profile__loading">正在加载…</p>

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

    <button
      type="button"
      class="profile__logout"
      data-testid="logout"
      @click="onLogout"
    >
      退出登录
    </button>
  </main>
</template>

<style scoped>
.profile {
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--mall-ink);
}
.profile__hero {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  box-shadow: 0 1px 3px rgba(143, 181, 143, 0.08);
}
.profile__avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--mall-leaf);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 500;
}
.profile__hero h1 {
  margin: 4px 0 0;
  font-size: 18px;
}
.profile__phone {
  margin: 0;
  color: var(--mall-muted);
  font-size: 13px;
}
.profile__phone--missing {
  color: var(--mall-apricot);
}
.profile__loading {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 16px;
  text-align: center;
  color: var(--mall-muted);
}
.profile__section {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 12px 16px;
}
.profile__section h2 {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--mall-leaf);
}
.profile__section dl {
  margin: 0;
  display: grid;
  grid-template-columns: 80px 1fr;
  row-gap: 6px;
  font-size: 14px;
}
.profile__section dt {
  color: var(--mall-muted);
}
.profile__section dd {
  margin: 0;
  color: var(--mall-ink);
}
.profile__id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--mall-muted);
}
.profile__hint {
  margin: 8px 0 0;
  color: var(--mall-muted);
  font-size: 12px;
}
.profile__logout {
  height: 48px;
  border-radius: var(--van-radius-lg);
  border: 1px solid rgba(193, 77, 77, 0.3);
  background: #fff;
  color: #c14d4d;
  font-size: 15px;
  cursor: pointer;
}
</style>
