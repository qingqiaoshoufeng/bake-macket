<script setup lang="ts">
import type { HomepageValidationIssue } from '@bake-mall/contracts';
import { ElButton, ElTag } from 'element-plus';

withDefaults(
  defineProps<{
    readonly dirty: boolean;
    readonly loading: boolean;
    readonly saving: boolean;
    readonly publishing: boolean;
    readonly canPublish: boolean;
    readonly version: number;
    readonly publishedVersion?: number;
    readonly issues?: readonly HomepageValidationIssue[];
  }>(),
  { publishedVersion: undefined, issues: () => [] },
);

const emit = defineEmits<{
  save: [];
  publish: [];
  'locate-issue': [issue: HomepageValidationIssue];
}>();
</script>

<template>
  <footer class="homepage-publish-bar">
    <div class="homepage-publish-bar__status">
      <ElTag :type="dirty ? 'warning' : 'success'">
        {{ dirty ? '有未保存内容' : '草稿已保存' }}
      </ElTag>
      <span>草稿版本 {{ version }}</span>
      <span>线上版本 {{ publishedVersion ?? '尚未发布' }}</span>
      <button
        v-if="issues.length"
        type="button"
        @click="emit('locate-issue', issues[0])"
      >
        {{ issues.length }} 个发布问题
      </button>
    </div>
    <div class="homepage-publish-bar__actions">
      <ElButton
        :loading="saving"
        :disabled="loading || saving || publishing"
        @click="emit('save')"
      >
        保存草稿
      </ElButton>
      <ElButton
        type="primary"
        :loading="publishing"
        :disabled="!canPublish"
        :title="dirty ? '请先保存草稿再发布' : undefined"
        @click="emit('publish')"
      >
        发布到 H5
      </ElButton>
    </div>
  </footer>
</template>

<style scoped>
.homepage-publish-bar {
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 14px;
  border: 1px solid var(--admin-border);
  border-radius: 16px;
  background: rgb(255 255 255 / 92%);
  box-shadow: 0 16px 35px rgb(73 57 105 / 16%);
  backdrop-filter: blur(14px);
}

.homepage-publish-bar__status,
.homepage-publish-bar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
}

.homepage-publish-bar__status {
  color: var(--admin-muted);
  font-size: 12px;
}

.homepage-publish-bar__status button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--admin-danger);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

@media (max-width: 720px) {
  .homepage-publish-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .homepage-publish-bar__actions :deep(.el-button) {
    flex: 1;
  }
}
</style>
