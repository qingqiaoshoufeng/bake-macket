<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { ElAlert, ElButton, ElMessage } from 'element-plus';
import { useRoute } from 'vue-router';

import { ApiClientError } from '../../api/http.js';
import ProductForm from './components/ProductForm.vue';
import {
  useProductEditor,
  type ProductEditorMode,
} from './hooks/useProductEditor.js';

const route = useRoute();
const editorMode = computed<ProductEditorMode>(() => {
  const productId = typeof route.params.id === 'string' ? route.params.id : '';
  return productId ? { mode: 'edit', productId } : { mode: 'new' };
});
const editorModeKey = computed(() =>
  editorMode.value.mode === 'edit'
    ? `edit:${editorMode.value.productId}`
    : 'new',
);
const editor = shallowRef(useProductEditor(editorMode.value));
const title = computed(() =>
  editorMode.value.mode === 'edit' ? '编辑商品' : '新增商品',
);
const loadErrorMessage = computed(() =>
  editor.value.loadError.value ? '商品加载失败，请重试' : null,
);

watch(
  editorModeKey,
  () => {
    editor.value = useProductEditor(editorMode.value);
    void editor.value.load();
  },
  { immediate: true },
);

async function save(): Promise<void> {
  try {
    await editor.value.save();
    ElMessage.success('商品保存成功');
  } catch (error) {
    if (!editor.value.stockConflict.value) {
      ElMessage.error(
        error instanceof ApiClientError
          ? error.message
          : '保存商品失败，请检查表单后重试',
      );
    }
  }
}

function retry(): void {
  void editor.value.load();
}

function reload(): void {
  void editor.value.reload();
}
</script>

<template>
  <section class="product-editor">
    <header class="product-editor__head">
      <div>
        <h1>{{ title }}</h1>
        <p>维护商品信息、图文详情和 SKU 库存。</p>
      </div>
    </header>

    <ElAlert
      v-if="loadErrorMessage"
      type="error"
      :title="loadErrorMessage"
      :closable="false"
      show-icon
    >
      <template #default>
        <ElButton size="small" data-testid="retry-editor" @click="retry"
          >重试</ElButton
        >
      </template>
    </ElAlert>

    <ElAlert
      v-if="editor.stockConflict.value"
      type="warning"
      title="库存已发生变化，请重新加载后再保存"
      :closable="false"
      show-icon
    >
      <template #default>
        <ElButton size="small" @click="reload">重新加载</ElButton>
      </template>
    </ElAlert>

    <div v-if="editor.loading.value" class="product-editor__loading">
      正在加载商品信息…
    </div>

    <ProductForm
      v-else
      :form="editor.form.value"
      :categories="editor.categories.value"
      :saving="editor.saving.value"
      :uploading="editor.uploading.value"
      @update:form="editor.replaceForm"
      @update:uploading="editor.setUploading"
      @submit="save"
    />

    <section
      v-if="editor.savedPreviewHtml.value"
      class="product-editor__preview"
    >
      <h2>已保存详情预览</h2>
      <!-- savedPreviewHtml only accepts server-sanitized response HTML. -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        data-testid="saved-preview"
        v-html="editor.savedPreviewHtml.value"
      ></div>
    </section>
  </section>
</template>

<style scoped>
.product-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.product-editor__head h1,
.product-editor__preview h2 {
  margin: 0;
  color: #2f2a3d;
}

.product-editor__head p {
  margin: 4px 0 0;
  color: #8a83a3;
  font-size: 13px;
}

.product-editor__loading,
.product-editor__preview {
  padding: 20px;
  border-radius: 16px;
  background: #fff;
}

.product-editor__preview {
  border: 1px solid #ece6f7;
}
</style>
