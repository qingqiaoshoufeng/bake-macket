<script setup lang="ts">
import type {
  AdminHomepageDraftSummary,
  HomepageValidationIssue,
} from '@bake-mall/contracts';
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
import HomepageDraftCreateDialog from './components/HomepageDraftCreateDialog.vue';
import HomepageDraftSidebar from './components/HomepageDraftSidebar.vue';
import HomepageEditorForm from './components/HomepageEditorForm.vue';
import HomepagePhonePreview from './components/HomepagePhonePreview.vue';
import HomepagePublishBar from './components/HomepagePublishBar.vue';
import { useHomepageDrafts } from './hooks/useHomepageDrafts.js';
import { useHomepageEditor } from './hooks/useHomepageEditor.js';
import type { HomepageDraftCreateForm } from './type/form.js';

const drafts = useHomepageDrafts();
const editor = useHomepageEditor();
const editorForm = ref<InstanceType<typeof HomepageEditorForm> | null>(null);
const createDialogVisible = ref(false);
const creating = ref(false);
const switchingDraft = ref(false);
const listLoading = computed(() => drafts.loading.value);
const editorLoading = computed(() => editor.loading.value);
const hasDraft = computed(
  () =>
    Boolean(drafts.activeId.value) &&
    drafts.activeId.value === editor.draftId.value,
);
const hasAlert = computed(
  () =>
    Boolean(drafts.error.value && !listLoading.value) ||
    Boolean(editor.lastError.value && !editorLoading.value) ||
    Boolean(editor.conflict.value),
);

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function bootstrap(): Promise<boolean> {
  try {
    const current = await drafts.load();
    if (!current) return false;
    if (drafts.error.value) {
      ElMessage.error(drafts.error.value);
      return false;
    }
    const id = drafts.activeId.value;
    if (!id) return false;
    await editor.load(id);
    return true;
  } catch (error) {
    ElMessage.error(message(error, '首页配置加载失败'));
    return false;
  }
}

async function refreshSummaries(
  page: number,
  preferredId: string | null,
): Promise<void> {
  try {
    await drafts.load(
      { page, pageSize: drafts.pageSize.value },
      preferredId ?? undefined,
    );
  } catch (error) {
    ElMessage.error(message(error, '首页草稿列表刷新失败'));
  }
}

async function save(showSuccess = true): Promise<boolean> {
  try {
    const currentDraftId = editor.draftId.value;
    const saved = await editor.saveDraft();
    if (!saved) return false;
    await refreshSummaries(1, currentDraftId);
    if (showSuccess) ElMessage.success('首页草稿已保存');
    return true;
  } catch (error) {
    if (!editor.conflict.value) {
      ElMessage.error(message(error, '首页草稿保存失败'));
    }
    return false;
  }
}

async function publish(): Promise<void> {
  if (editor.dirty.value) {
    ElMessage.warning('请先保存草稿再发布');
    return;
  }
  try {
    const activeId = drafts.activeId.value;
    const currentPage = drafts.page.value;
    const succeeded = await editor.publish();
    if (!succeeded) return;
    await refreshSummaries(currentPage, activeId);
    ElMessage.success('首页已发布到 H5');
  } catch (error) {
    ElMessage.error(message(error, '首页发布失败'));
    if (editor.issues.value[0]) void locateIssue(editor.issues.value[0]);
  }
}

async function saveForTransition(): Promise<boolean> {
  try {
    const saved = await editor.saveDraft();
    if (!saved) return false;
    drafts.reconcileDetail(saved);
    return true;
  } catch (error) {
    if (!editor.conflict.value) {
      ElMessage.error(message(error, '首页草稿保存失败'));
    }
    return false;
  }
}

async function loadAndSelect(id: string): Promise<boolean> {
  try {
    await editor.load(id);
    drafts.select(id);
    return true;
  } catch (error) {
    ElMessage.error(message(error, '首页草稿加载失败'));
    return false;
  }
}

type DirtyTransitionOptions = {
  readonly message: string;
  readonly title: string;
  readonly confirmButtonText: string;
  readonly cancelButtonText: string;
};

async function resolveDirtyTransition(
  options: DirtyTransitionOptions,
): Promise<boolean> {
  if (!editor.dirty.value) return true;
  try {
    await ElMessageBox.confirm(options.message, options.title, {
      type: 'warning',
      confirmButtonText: options.confirmButtonText,
      cancelButtonText: options.cancelButtonText,
      distinguishCancelAndClose: true,
    });
    return saveForTransition();
  } catch (action) {
    return action === 'cancel';
  }
}

async function selectDraft(id: string): Promise<void> {
  if (
    id === drafts.activeId.value ||
    editor.loading.value ||
    editor.saving.value ||
    editor.publishing.value ||
    switchingDraft.value
  )
    return;
  switchingDraft.value = true;
  try {
    const canSwitch = await resolveDirtyTransition({
      message: '当前草稿尚未保存，请选择如何处理后再切换。',
      title: '切换首页草稿',
      confirmButtonText: '保存并切换',
      cancelButtonText: '放弃修改并切换',
    });
    if (canSwitch) await loadAndSelect(id);
  } finally {
    switchingDraft.value = false;
  }
}

function openCreateDialog(): void {
  createDialogVisible.value = true;
}

async function createDraft(form: HomepageDraftCreateForm): Promise<void> {
  const canCreate = await resolveDirtyTransition({
    message: '当前草稿尚未保存，请选择如何处理后再创建新草稿。',
    title: '创建首页草稿',
    confirmButtonText: '保存并创建',
    cancelButtonText: '放弃修改并创建',
  });
  if (!canCreate) return;
  creating.value = true;
  try {
    const created = await drafts.create(form);
    createDialogVisible.value = false;
    await editor.load(created.id);
    ElMessage.success('首页草稿已创建');
  } catch (error) {
    ElMessage.error(message(error, '首页草稿创建失败'));
  } finally {
    creating.value = false;
  }
}

async function renameDraft(item: AdminHomepageDraftSummary): Promise<void> {
  try {
    const result = await ElMessageBox.prompt(
      '请输入新的草稿名称',
      '重命名草稿',
      {
        inputValue: item.name,
        inputPlaceholder: '草稿名称',
        inputValidator: (value: string) => {
          const length = value.trim().length;
          if (length === 0) return '请输入草稿名称';
          return length <= 120 || '草稿名称不能超过 120 个字符';
        },
        confirmButtonText: '保存名称',
        cancelButtonText: '取消',
      },
    );
    const renamed = await drafts.rename(item.id, result.value.trim());
    editor.reconcileMetadata(renamed);
    ElMessage.success('草稿名称已更新');
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(message(error, '首页草稿重命名失败'));
  }
}

async function removeDraft(item: AdminHomepageDraftSummary): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除“${item.name}”后无法恢复，是否继续？`,
      '删除首页草稿',
      {
        type: 'warning',
        confirmButtonText: '删除草稿',
        cancelButtonText: '取消',
      },
    );
    await drafts.remove(item.id);
    const nextId = drafts.activeId.value;
    if (nextId && nextId !== editor.draftId.value) {
      await editor.load(nextId);
    }
    ElMessage.success('首页草稿已删除');
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(message(error, '首页草稿删除失败'));
  }
}

async function changePage(page: number): Promise<void> {
  if (editor.dirty.value) {
    ElMessage.warning('请先保存当前草稿再翻页');
    return;
  }
  const current = await drafts.load({ page, pageSize: drafts.pageSize.value });
  if (!current || !drafts.activeId.value) return;
  await editor.load(drafts.activeId.value);
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
    const id = drafts.activeId.value;
    if (!id) return;
    await editor.load(id);
    ElMessage.success('已加载服务器最新草稿');
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(message(error, '首页草稿加载失败'));
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
  void bootstrap();
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
          v-if="drafts.error.value && !listLoading"
          type="error"
          title="首页草稿列表加载失败"
          :description="drafts.error.value"
          :closable="false"
          show-icon
        />
        <ElAlert
          v-if="editor.lastError.value && !editorLoading"
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

      <div class="homepage-editor-view__layout">
        <HomepageDraftSidebar
          data-workspace-column="drafts"
          :items="drafts.items.value"
          :active-id="drafts.activeId.value"
          :loading="listLoading"
          :page="drafts.page.value"
          :page-size="drafts.pageSize.value"
          :total="drafts.total.value"
          @select="selectDraft"
          @create="openCreateDialog"
          @rename="renameDraft"
          @remove="removeDraft"
          @page-change="changePage"
        />

        <section
          class="homepage-editor-view__configuration"
          data-workspace-column="editor"
          data-editor-scroll
        >
          <div v-if="editorLoading" class="homepage-editor-view__loading">
            <strong>正在读取首页装修草稿</strong>
            <ElSkeleton :rows="10" animated />
          </div>
          <HomepageEditorForm
            v-else-if="hasDraft"
            ref="editorForm"
            :draft="editor.draft.value"
            :categories="editor.categories.value"
            :products="editor.products.value"
            :issues="editor.issues.value"
            @update:draft="editor.replaceDraft"
          />
          <div v-else class="homepage-editor-view__empty">
            <span>
              {{
                drafts.error.value
                  ? '首页草稿暂时无法加载'
                  : '还没有首页草稿，请先创建草稿'
              }}
            </span>
            <ElButton
              v-if="!drafts.error.value"
              type="primary"
              @click="openCreateDialog"
            >
              创建第一个草稿
            </ElButton>
          </div>
        </section>

        <aside
          class="homepage-editor-view__preview"
          data-workspace-column="preview"
        >
          <HomepagePhonePreview v-if="hasDraft" :draft="editor.draft.value" />
          <div v-else class="homepage-editor-view__preview-empty">
            选择或创建草稿后查看手机预览
          </div>
        </aside>
      </div>

      <HomepagePublishBar
        v-if="hasDraft"
        :name="editor.name.value"
        :status="editor.status.value"
        :dirty="editor.dirty.value"
        :loading="editorLoading"
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

    <HomepageDraftCreateDialog
      :visible="createDialogVisible"
      :active-draft-id="drafts.activeId.value"
      :submitting="creating"
      @submit="createDraft"
      @cancel="createDialogVisible = false"
    />
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
  grid-template-columns:
    minmax(210px, 0.48fr) minmax(500px, 1.35fr)
    minmax(320px, 0.78fr);
  grid-template-areas: 'drafts editor preview';
  gap: 18px;
  overflow: hidden;
}

.homepage-editor-view__layout > [data-workspace-column='drafts'] {
  grid-area: drafts;
}

.homepage-editor-view__configuration,
.homepage-editor-view__preview {
  min-width: 0;
  min-height: 0;
}

.homepage-editor-view__configuration {
  grid-area: editor;
  padding-right: 8px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: color-mix(in srgb, var(--admin-mint) 45%, transparent)
    transparent;
  scrollbar-width: thin;
}

.homepage-editor-view__preview {
  grid-area: preview;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.homepage-editor-view__loading,
.homepage-editor-view__empty,
.homepage-editor-view__preview-empty {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-card);
}

.homepage-editor-view__empty,
.homepage-editor-view__preview-empty {
  place-items: center;
  min-height: 180px;
  color: var(--admin-muted);
  text-align: center;
}

.homepage-editor-view__alert-copy {
  margin: 0 0 10px;
}

@media (max-width: 1400px) {
  .homepage-editor-view__layout {
    grid-template-columns: minmax(180px, 0.32fr) minmax(0, 1fr);
    grid-template-areas:
      'drafts editor'
      'drafts preview';
    grid-template-rows: minmax(520px, auto) auto;
    gap: 12px;
    overflow-y: auto;
  }

  .homepage-editor-view__layout > [data-workspace-column='drafts'] {
    position: sticky;
    top: 0;
    grid-row: 1 / -1;
    max-height: 100%;
  }

  .homepage-editor-view__configuration {
    min-height: 520px;
    overflow: visible;
  }

  .homepage-editor-view__preview {
    grid-area: preview;
    overflow: visible;
  }

  .homepage-editor-view__preview :deep(.homepage-phone-preview) {
    min-height: 560px;
  }
}
</style>
