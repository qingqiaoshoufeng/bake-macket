<script setup lang="ts">
import {
  ElAvatar,
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDrawer,
  ElEmpty,
  ElResult,
  ElTag,
} from 'element-plus';
import { computed, ref, watch } from 'vue';

import type { AdminUserDetailView } from '../type/index.js';

const props = defineProps<{
  readonly modelValue: boolean;
  readonly detail: AdminUserDetailView | null;
  readonly loading: boolean;
  readonly error: string | null;
}>();

const emit = defineEmits<{
  close: [];
  retry: [];
}>();

const avatarFailed = ref(false);
const displayName = computed(
  () => props.detail?.nickname?.trim() || '未设置昵称',
);
const avatarInitial = computed(() => displayName.value.slice(0, 1));
const avatarUrl = computed(() => {
  const candidate = props.detail?.avatarUrl?.trim();
  if (!candidate || avatarFailed.value) return null;
  if (candidate.startsWith('/bake-mall/')) return candidate;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'))
      ? candidate
      : null;
  } catch {
    return null;
  }
});

watch(
  () => props.detail?.avatarUrl,
  () => {
    avatarFailed.value = false;
  },
);

function operatorStatus(detail: AdminUserDetailView): string {
  if (!detail.operator.isOperator) return '未授权';
  return detail.operator.active ? '已启用' : '已停用';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN');
}
</script>

<template>
  <ElDrawer
    :model-value="modelValue"
    title="用户详情"
    size="min(620px, 96vw)"
    @close="emit('close')"
  >
    <div v-loading="loading" class="user-detail">
      <ElResult
        v-if="error"
        icon="error"
        title="用户详情加载失败"
        :sub-title="error"
      >
        <template #extra>
          <ElButton
            type="primary"
            data-testid="retry-user-detail"
            @click="emit('retry')"
          >
            重新加载
          </ElButton>
        </template>
      </ElResult>

      <template v-else-if="detail">
        <header class="user-detail__profile">
          <ElAvatar
            :size="64"
            :src="avatarUrl ?? undefined"
            @error="avatarFailed = true"
          >
            {{ avatarInitial }}
          </ElAvatar>
          <div>
            <strong>{{ displayName }}</strong>
            <span>ID {{ detail.id }}</span>
          </div>
        </header>

        <section class="user-detail__group">
          <h3>微信身份</h3>
          <ElDescriptions :column="2" border>
            <ElDescriptionsItem label="微信账号">
              <ElTag :type="detail.wechat.bound ? 'success' : 'info'">
                {{ detail.wechat.bound ? '已绑定' : '未绑定' }}
              </ElTag>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="OpenID">
              <code class="user-detail__identifier">{{
                detail.wechat.openid ?? '未获取'
              }}</code>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="UnionID">
              <code class="user-detail__identifier">{{
                detail.wechat.unionid ?? '未获取'
              }}</code>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="身份手机号">
              {{ detail.identityPhone.masked ?? '未绑定' }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="手机号验证">
              <ElTag :type="detail.identityPhone.verified ? 'success' : 'info'">
                {{ detail.identityPhone.verified ? '已验证' : '未验证' }}
              </ElTag>
            </ElDescriptionsItem>
          </ElDescriptions>
        </section>

        <section class="user-detail__group">
          <h3>账号与管理身份</h3>
          <ElDescriptions :column="2" border>
            <ElDescriptionsItem label="顾客账号">
              <ElTag :type="detail.account.isActive ? 'success' : 'danger'">
                {{ detail.account.isActive ? '正常' : '已停用' }}
              </ElTag>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="合并状态">
              {{
                detail.account.mergedIntoUserId
                  ? `已合并至 ${detail.account.mergedIntoUserId}`
                  : '未合并'
              }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="操作员">
              {{ operatorStatus(detail) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="管理员登录手机号">
              {{ detail.operator.loginPhoneMasked ?? '未配置' }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="首次登录改密">
              {{ detail.operator.mustChangePassword ? '需要' : '不需要' }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="创建时间">
              {{ formatDate(detail.createdAt) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="更新时间">
              {{ formatDate(detail.updatedAt) }}
            </ElDescriptionsItem>
          </ElDescriptions>
        </section>
      </template>

      <ElEmpty v-else-if="!loading" description="暂无用户详情" />
    </div>
  </ElDrawer>
</template>

<style scoped>
.user-detail {
  min-height: 220px;
}

.user-detail__profile {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 0 20px;
}

.user-detail__profile strong,
.user-detail__profile span {
  display: block;
}

.user-detail__profile strong {
  color: var(--admin-text);
  font-size: 19px;
}

.user-detail__profile span {
  margin-top: 5px;
  color: var(--admin-muted);
  font-size: 12px;
}

.user-detail__identifier {
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow-wrap: anywhere;
  user-select: text;
  word-break: break-all;
}

.user-detail__group + .user-detail__group {
  margin-top: 24px;
}

.user-detail__group h3 {
  margin: 0 0 12px;
  color: var(--admin-text);
  font-size: 15px;
}

@media (max-width: 720px) {
  .user-detail__group :deep(.el-descriptions__body .el-descriptions__table) {
    table-layout: auto;
  }
}
</style>
