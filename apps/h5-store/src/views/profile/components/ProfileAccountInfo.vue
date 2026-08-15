<script setup lang="ts">
import type { UserProfileView } from '@bake-mall/contracts';

defineProps<{ profile: UserProfileView | null }>();
</script>

<template>
  <section class="profile-account">
    <h2>账号信息</h2>
    <dl>
      <dt>昵称</dt>
      <dd>{{ profile?.nickname ?? '—' }}</dd>
      <dt>身份手机号</dt>
      <dd>
        {{
          profile?.phoneVerified && profile.phone
            ? profile.phone
            : '未验证身份手机号'
        }}
      </dd>
      <dt>用户 ID</dt>
      <dd class="profile-account__id">{{ profile?.id ?? '—' }}</dd>
    </dl>
    <p>头像与昵称为微信账号绑定信息，首期暂不支持在 H5 修改。</p>
  </section>
</template>

<style scoped>
.profile-account {
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.profile-account h2 {
  margin: 0 0 var(--mall-space-3);
  color: var(--mall-primary-strong);
  font-size: 14px;
}
.profile-account dl {
  display: grid;
  margin: 0;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: var(--mall-space-2) var(--mall-space-3);
  font-size: 14px;
}
.profile-account dt {
  color: var(--mall-text-muted);
}
.profile-account dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.profile-account__id {
  color: var(--mall-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.profile-account p {
  margin: var(--mall-space-3) 0 0;
  padding-top: var(--mall-space-3);
  border-top: 1px dashed var(--mall-border);
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.6;
}
</style>
