<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { ElAlert, ElButton, ElMessage, ElSkeleton } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';

import { ApiClientError } from '../../api/http.js';
import SanitizedHtmlPreview from '../../components/SanitizedHtmlPreview.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import ProductForm from './components/ProductForm.vue';
import {
  useProductEditor,
  type ProductEditorMode,
} from './hooks/useProductEditor.js';

const route = useRoute();
const router = useRouter();
const editorMode = computed<ProductEditorMode>(() => {
  const productId = typeof route.params.id === 'string' ? route.params.id : '';
  return productId ? { mode: 'edit', productId } : { mode: 'new' };
});
const editorModeKey = computed(() =>
  editorMode.value.mode === 'edit'
    ? `edit:${editorMode.value.productId}`
    : 'new',
);
const createdProductId = shallowRef<string | null>(null);
const rememberCreatedProduct = (productId: string): void => {
  createdProductId.value = productId;
};
const createEditor = () =>
  useProductEditor(editorMode.value, rememberCreatedProduct);
const editor = shallowRef(createEditor());
const title = computed(() =>
  editorMode.value.mode === 'edit' ? '编辑商品' : '新增商品',
);
const loadErrorMessage = computed(() =>
  editor.value.loadError.value ? '商品加载失败，请重试' : null,
);

watch(
  editorModeKey,
  () => {
    editor.value = createEditor();
    void editor.value.load();
  },
  { immediate: true },
);

async function save(): Promise<void> {
  try {
    await editor.value.save();
    ElMessage.success('商品保存成功');
    if (createdProductId.value) {
      const productId = createdProductId.value;
      createdProductId.value = null;
      await router.replace({
        name: 'admin-product-edit',
        params: { id: productId },
      });
    }
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
  <AdminPage class="product-editor">
    <AdminPageHeader
      eyebrow="PRODUCT STUDIO"
      :title="title"
      description="沿着基础信息、媒体、详情、SKU 与发布设置，完成一条清晰的商品维护流程。"
    />

    <section
      v-if="loadErrorMessage || editor.stockConflict.value"
      class="product-editor__feedback"
      aria-label="商品编辑反馈"
    >
      <ElAlert
        v-if="loadErrorMessage"
        type="error"
        :title="loadErrorMessage"
        :closable="false"
        show-icon
      >
        <template #default>
          <ElButton size="small" data-testid="retry-editor" @click="retry">
            重试加载
          </ElButton>
        </template>
      </ElAlert>

      <ElAlert
        v-if="editor.stockConflict.value"
        type="warning"
        title="库存已发生变化，请重新加载后再保存"
        description="你的当前草稿仍然保留。重新加载会以服务端最新数据替换草稿，请确认后操作。"
        :closable="false"
        show-icon
      >
        <template #default>
          <ElButton size="small" @click="reload">重新加载</ElButton>
        </template>
      </ElAlert>
    </section>

    <section
      v-if="editor.loading.value"
      class="product-editor__loading"
      aria-live="polite"
    >
      <div class="product-editor__loading-copy">
        <strong>正在加载商品信息</strong>
        <span>稍候片刻，编辑草稿即将就绪。</span>
      </div>
      <ElSkeleton :rows="6" animated />
    </section>

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
      <header class="product-editor__preview-head">
        <div>
          <span>SERVER RESPONSE</span>
          <h2>已保存详情预览</h2>
        </div>
        <p>
          这里仅展示保存接口返回并经过统一安全清洗的内容，不跟随未保存草稿变化。
        </p>
      </header>
      <SanitizedHtmlPreview
        data-testid="saved-preview"
        :html="editor.savedPreviewHtml.value"
      />
    </section>
  </AdminPage>
</template>

<style scoped>
.product-editor__feedback {
  display: grid;
  gap: 10px;
}

.product-editor__loading,
.product-editor__preview {
  padding: 22px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-card);
}

.product-editor__loading {
  display: grid;
  gap: 18px;
}

.product-editor__loading-copy {
  display: grid;
  gap: 3px;
}

.product-editor__loading-copy strong {
  color: var(--admin-text);
}

.product-editor__loading-copy span {
  color: var(--admin-muted);
  font-size: 13px;
}

.product-editor__preview {
  display: grid;
  gap: 20px;
}

.product-editor__preview-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--admin-border);
}

.product-editor__preview-head span {
  color: var(--admin-mint);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.product-editor__preview-head h2,
.product-editor__preview-head p {
  margin: 0;
}

.product-editor__preview-head h2 {
  margin-top: 5px;
  color: var(--admin-text);
  font-size: 18px;
}

.product-editor__preview-head p {
  max-width: 480px;
  color: var(--admin-muted);
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 720px) {
  .product-editor__preview-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
