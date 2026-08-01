<script setup lang="ts">
import type { HomepageValidationIssue } from '@bake-mall/contracts';
import {
  ElAlert,
  ElButton,
  ElMessage,
  ElMessageBox,
  ElSkeleton,
} from 'element-plus';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

import AdminPage from '../../components/layout/AdminPage.vue';
import HomepageEditorForm from './components/HomepageEditorForm.vue';
import HomepagePhonePreview from './components/HomepagePhonePreview.vue';
import HomepagePublishBar from './components/HomepagePublishBar.vue';
import { useHomepageEditor } from './hooks/useHomepageEditor.js';

const editor = useHomepageEditor();
const editorForm = ref<InstanceType<typeof HomepageEditorForm> | null>(null);
const hasAlert = computed(
  () =>
    Boolean(editor.lastError.value && !editor.loading.value) ||
    Boolean(editor.conflict.value),
);

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
    const succeeded = await editor.saveDraft();
    if (succeeded) ElMessage.success('首页草稿已保存');
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
    const succeeded = await editor.publish();
    if (succeeded) ElMessage.success('首页已发布到 H5');
  } catch (error) {
    ElMessage.error(message(error, '首页发布失败'));
    if (editor.issues.value[0]) void locateIssue(editor.issues.value[0]);
  }
}

async function reloadServerDraft(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '重新加载会覆盖当前本地草稿，是否继续？',
      '确认重新加载',
      {
        type: 'warning',
        confirmButtonText: '重新加载',
        cancelButtonText: '保留本地草稿',
      },
    );
    await load();
    ElMessage.success('已加载服务器最新草稿');
  } catch {
    // 取消时必须保留本地草稿和冲突提示。
  }
}

async function locateIssue(issue: HomepageValidationIssue): Promise<void> {
  const targetId = issue.itemId ?? issue.sectionId;
  editorForm.value?.openItem(targetId);
  await nextTick();
  document
    .getElementById(targetId)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      {
        type: 'warning',
        confirmButtonText: '离开',
        cancelButtonText: '继续编辑',
      },
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

onBeforeUnmount(() =>
  window.removeEventListener('beforeunload', confirmUnload),
);
</script>

<template>
  <AdminPage class="homepage-editor-view">
    <div
      class="homepage-editor-view__workspace"
      :class="{ 'homepage-editor-view__workspace--with-alert': hasAlert }"
    >
      <div v-if="hasAlert" class="homepage-editor-view__alerts">
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
              {{
                editor.conflict.value
              }}。本地草稿仍然保留，只有明确重新加载才会覆盖。
            </p>
            <ElButton size="small" @click="reloadServerDraft">
              重新加载服务器草稿
            </ElButton>
          </template>
        </ElAlert>
      </div>

      <section
        v-if="editor.loading.value"
        class="homepage-editor-view__loading"
      >
        <strong>正在读取首页装修草稿</strong>
        <ElSkeleton :rows="10" animated />
      </section>

      <div v-else class="homepage-editor-view__layout">
        <div class="homepage-editor-view__configuration" data-editor-scroll>
          <HomepageEditorForm
            ref="editorForm"
            :draft="editor.draft.value"
            :categories="editor.categories.value"
            :products="editor.products.value"
            :issues="editor.issues.value"
            @update:draft="editor.replaceDraft"
          />
        </div>
        <HomepagePhonePreview :draft="editor.draft.value" />
      </div>

      <HomepagePublishBar
        :dirty="editor.dirty.value"
        :loading="editor.loading.value"
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
    </div>
  </AdminPage>
</template>

<style scoped>
.homepage-editor-view,
.homepage-editor-view__workspace,
.homepage-editor-view__layout {
  min-height: 0;
}

.homepage-editor-view {
  height: 100%;
  overflow: hidden;
}

.homepage-editor-view__alerts {
  display: grid;
  gap: 10px;
}

.homepage-editor-view__workspace {
  display: grid;
  height: 100%;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 12px;
  overflow: hidden;
}

.homepage-editor-view__workspace--with-alert {
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.homepage-editor-view__layout {
  display: grid;
  height: 100%;
  grid-template-columns: minmax(500px, 1.45fr) minmax(320px, 0.8fr);
  gap: 22px;
  overflow: hidden;
}

.homepage-editor-view__configuration {
  min-width: 0;
  min-height: 0;
  padding-right: 8px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: color-mix(in srgb, var(--admin-mint) 45%, transparent)
    transparent;
  scrollbar-width: thin;
}

.homepage-editor-view__configuration > * + * {
  margin-top: 14px;
}

.homepage-editor-view__loading {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-card);
}

.homepage-editor-view__alert-copy {
  margin: 0 0 10px;
}

@media (max-width: 1180px) {
  .homepage-editor-view__layout {
    grid-template-columns: minmax(430px, 1fr) minmax(280px, 0.72fr);
    gap: 14px;
  }
}
</style>
