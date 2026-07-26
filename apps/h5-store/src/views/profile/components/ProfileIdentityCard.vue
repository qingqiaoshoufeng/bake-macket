<script setup lang="ts">
import type { UserProfileView } from '@bake-mall/contracts';

defineProps<{ profile: UserProfileView | null }>();
</script>

<template>
  <section class="profile-identity">
    <div class="profile-identity__avatar" aria-hidden="true">
      {{ profile?.nickname?.slice(0, 1).toUpperCase() ?? '客' }}
    </div>
    <div class="profile-identity__copy">
      <p>BAKE MATE</p>
      <h2>{{ profile?.nickname ?? '游客' }}</h2>
      <span :class="{ 'is-missing': !profile?.phone }">
        {{ profile?.phone ?? '未绑定手机号' }}
      </span>
    </div>
  </section>
</template>

<style scoped>
.profile-identity {
  display: flex;
  min-width: 0;
  padding: var(--mall-space-5);
  align-items: center;
  gap: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-feature);
  background: linear-gradient(135deg, #f2f8ef, #fffaf4);
  box-shadow: var(--mall-shadow-card);
}
.profile-identity__avatar {
  display: grid;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  place-items: center;
  border: 4px solid rgb(255 255 255 / 82%);
  border-radius: 50%;
  background: var(--mall-primary);
  color: #fff;
  font-size: 25px;
  font-weight: 700;
  box-shadow: var(--mall-shadow-card);
}
.profile-identity__copy {
  min-width: 0;
}
.profile-identity__copy p,
.profile-identity__copy h2 {
  margin: 0;
}
.profile-identity__copy p {
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
}
.profile-identity__copy h2 {
  margin-top: var(--mall-space-1);
  overflow: hidden;
  font-size: 21px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-identity__copy span {
  display: block;
  margin-top: var(--mall-space-1);
  color: var(--mall-text-muted);
  font-size: 13px;
}
.profile-identity__copy .is-missing {
  color: var(--mall-accent);
}
</style>
