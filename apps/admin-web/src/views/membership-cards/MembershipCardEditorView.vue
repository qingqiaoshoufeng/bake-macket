<script setup lang="ts">
import { ElAlert, ElButton, ElMessage, ElSkeleton } from 'element-plus';
import { computed, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiClientError } from '../../api/http.js';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import MembershipCardForm from './components/MembershipCardForm.vue';
import {
  type MembershipCardEditorMode,
  useMembershipCardEditor,
} from './hooks/useMembershipCardEditor.js';

const route = useRoute();
const router = useRouter();
const mode = computed<MembershipCardEditorMode>(() => {
  const levelId = typeof route.params.id === 'string' ? route.params.id : '';
  return levelId ? { mode: 'edit', levelId } : { mode: 'new' };
});
const modeKey = computed(() =>
  mode.value.mode === 'edit' ? `edit:${mode.value.levelId}` : 'new',
);
const createEditor = () =>
  useMembershipCardEditor(mode.value, (levelId) => {
    void router.replace({
      name: 'admin-membership-card-edit',
      params: { id: levelId },
    });
  });
const editor = shallowRef(createEditor());
const title = computed(() =>
  mode.value.mode === 'edit' ? '编辑会员卡' : '新建会员卡',
);

watch(
  modeKey,
  () => {
    editor.value = createEditor();
    void editor.value.load();
  },
  { immediate: true },
);

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : error instanceof Error
      ? error.message
      : '保存会员卡失败，请检查表单后重试';
}

async function save(): Promise<void> {
  try {
    await editor.value.save();
    ElMessage.success('更改已保存');
  } catch (error) {
    if (!editor.value.conflict.value) ElMessage.error(errorMessage(error));
  }
}

async function reload(): Promise<void> {
  try {
    await editor.value.reload();
    ElMessage.success('已重新加载最新配置');
  } catch (error) {
    ElMessage.error(errorMessage(error));
  }
}
</script>

<template>
  <AdminPage class="membership-card-editor">
    <AdminPageHeader
      eyebrow="MEMBERSHIP RECIPE"
      :title="title"
      description="像维护一张烘焙配方卡一样，明确等级、计量、权益和卡面主题。"
    >
      <template #actions>
        <ElButton @click="router.push('/membership-cards')">返回列表</ElButton>
      </template>
    </AdminPageHeader>

    <ElAlert
      v-if="editor.loadError.value"
      type="error"
      title="会员卡配置加载失败"
      :description="errorMessage(editor.loadError.value)"
      :closable="false"
      show-icon
    >
      <template #default>
        <ElButton size="small" @click="editor.load">重新加载</ElButton>
      </template>
    </ElAlert>

    <ElAlert
      v-if="editor.conflict.value"
      type="warning"
      title="配置已被其他操作更新"
      :closable="false"
      show-icon
    >
      <template #default>
        <p class="membership-card-editor__conflict-copy">
          {{
            editor.conflict.value.message
          }}。当前草稿仍然保留；只有明确重新加载才会用最新配置覆盖草稿。
        </p>
        <ElButton
          size="small"
          data-testid="reload-membership-card"
          @click="reload"
        >
          重新加载
        </ElButton>
      </template>
    </ElAlert>

    <section
      v-if="editor.loading.value"
      class="membership-card-editor__loading"
    >
      <strong>正在读取会员卡配方</strong>
      <ElSkeleton :rows="8" animated />
    </section>

    <MembershipCardForm
      v-else
      :form="editor.form.value"
      :editing="mode.mode === 'edit'"
      :saving="editor.saving.value"
      @update:form="editor.replaceForm"
      @submit="save"
    />
  </AdminPage>
</template>

<style scoped>
.membership-card-editor__conflict-copy {
  margin: 0 0 10px;
}

.membership-card-editor__loading {
  display: grid;
  gap: 18px;
  padding: 24px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-card);
}
</style>
