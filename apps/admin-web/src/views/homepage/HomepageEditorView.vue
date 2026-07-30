<script setup lang="ts">
import type { HomepageValidationIssue } from '@bake-mall/contracts';
import {
  ElAlert,
  ElButton,
  ElMessage,
  ElMessageBox,
  ElSkeleton,
} from 'element-plus';
import { onBeforeUnmount, onMounted } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import HomepageEditorForm from './components/HomepageEditorForm.vue';
import HomepagePhonePreview from './components/HomepagePhonePreview.vue';
import HomepagePublishBar from './components/HomepagePublishBar.vue';
import { useHomepageEditor } from './hooks/useHomepageEditor.js';

const editor = useHomepageEditor();

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function load(): Promise<void> {
  try {
    await editor.load();
  } catch (error) {
    ElMessage.error(message(error, '首页配置加载失败'));
  }
}

async function save(): Promise<void> {
  try {
    await editor.saveDraft();
    ElMessage.success('首页草稿已保存');
  } catch (error) {
    if (!editor.conflict.value) {
      ElMessage.error(message(error, '首页草稿保存失败'));
    }
  }
}

async function publish(): Promise<void> {
  if (editor.dirty.value) {
    ElMessage.warning('请先保存草稿再发布');
    return;
  }
  try {
    await editor.publish();
    ElMessage.success('首页已发布到 H5');
  } catch (error) {
    ElMessage.error(message(error, '首页发布失败'));
    if (editor.issues.value[0]) locateIssue(editor.issues.value[0]);
  }
}

async function reloadServerDraft(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '重新加载会覆盖当前本地草稿，是否继续？',
      '确认重新加载',
      { type: 'warning', confirmButtonText: '重新加载', cancelButtonText: '保留本地草稿' },
    );
    await load();
    ElMessage.success('已加载服务器最新草稿');
  } catch {
    // 取消时必须保留本地草稿和冲突提示。
  }
}

function locateIssue(issue: HomepageValidationIssue): void {
  const target = document.getElementById(issue.itemId ?? issue.sectionId);
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function confirmUnload(event: BeforeUnloadEvent): void {
  if (!editor.dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onBeforeRouteLeave(async () => {
  if (!editor.dirty.value) return true;
  try {
    await ElMessageBox.confirm(
      '当前首页草稿尚未保存，确定离开吗？',
      '离开编辑页面',
      { type: 'warning', confirmButtonText: '离开', cancelButtonText: '继续编辑' },
    );
    return true;
  } catch {
    return false;
  }
});

onMounted(() => {
  window.addEventListener('beforeunload', confirmUnload);
  void load();
});

onBeforeUnmount(() => window.removeEventListener('beforeunload', confirmUnload));
</script>

<template>
  <AdminPage class="homepage-editor-view">
    <AdminPageHeader
      eyebrow="HOMEPAGE STUDIO"
      title="首页装修"
      description="保存草稿后先在手机模型中确认，再显式发布；未发布的修改不会影响线上商城。"
    />

    <ElAlert
      v-if="editor.lastError.value && !editor.loading.value"
      type="error"
      title="首页装修操作失败"
      :description="editor.lastError.value"
      :closable="false"
      show-icon
    />

    <ElAlert
      v-if="editor.conflict.value"
      type="warning"
      title="服务器草稿已更新"
      :closable="false"
      show-icon
    >
      <template #default>
        <p class="homepage-editor-view__alert-copy">
          {{ editor.conflict.value }}。本地草稿仍然保留，只有明确重新加载才会覆盖。
        </p>
        <ElButton size="small" @click="reloadServerDraft">重新加载服务器草稿</ElButton>
      </template>
    </ElAlert>

    <section v-if="editor.loading.value" class="homepage-editor-view__loading">
      <strong>正在读取首页装修草稿</strong>
      <ElSkeleton :rows="10" animated />
    </section>

    <template v-else>
      <div class="homepage-editor-view__layout">
        <div>
          <section
            v-if="editor.issues.value.length"
            class="homepage-editor-view__issues"
            aria-label="发布校验问题"
          >
            <header>
              <strong>发布前还需处理 {{ editor.issues.value.length }} 项</strong>
              <span>点击问题可定位到对应内容</span>
            </header>
            <button
              v-for="issue in editor.issues.value"
              :key="`${issue.code}-${issue.sectionId}-${issue.itemId ?? ''}-${issue.field ?? ''}`"
              type="button"
              @click="locateIssue(issue)"
            >
              {{ issue.message }}
            </button>
          </section>

          <HomepageEditorForm
            :draft="editor.draft.value"
            :categories="editor.categories.value"
            :products="editor.products.value"
            @update:draft="editor.replaceDraft"
          />
        </div>
        <HomepagePhonePreview :draft="editor.draft.value" />
      </div>

      <HomepagePublishBar
        :dirty="editor.dirty.value"
        :saving="editor.saving.value"
        :publishing="editor.publishing.value"
        :can-publish="editor.canPublish.value"
        :version="editor.version.value"
        :published-version="editor.publishedVersion.value"
        :issues="editor.issues.value"
        @save="save"
        @publish="publish"
        @locate-issue="locateIssue"
      />
    </template>
  </AdminPage>
</template>

<style scoped>
.homepage-editor-view {
  display: grid;
  gap: 18px;
}

.homepage-editor-view__layout {
  display: grid;
  align-items: start;
  grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.8fr);
  gap: 22px;
}

.homepage-editor-view__layout > div:first-child {
  display: grid;
  gap: 18px;
  min-width: 0;
}

.homepage-editor-view__loading,
.homepage-editor-view__issues {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-card);
}

.homepage-editor-view__issues {
  border-color: color-mix(in srgb, var(--admin-danger) 30%, var(--admin-border));
  background: color-mix(in srgb, var(--admin-danger) 4%, var(--admin-surface));
}

.homepage-editor-view__issues header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.homepage-editor-view__issues header span {
  color: var(--admin-muted);
  font-size: 12px;
}

.homepage-editor-view__issues button {
  padding: 10px 12px;
  border: 1px solid var(--admin-border);
  border-radius: 10px;
  background: var(--admin-surface);
  color: var(--admin-danger);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.homepage-editor-view__alert-copy {
  margin: 0 0 10px;
}

@media (max-width: 1180px) {
  .homepage-editor-view__layout {
    grid-template-columns: 1fr;
  }
}
</style>
