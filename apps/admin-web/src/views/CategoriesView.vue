<script setup lang="ts">
/**
 * Category management entry view (Task 12).
 *
 * Single-level categories only — the design spec does not allow nested
 * taxonomies. Composes the {@link useCategories} hook with the pure
 * presentational `CategoryTable` + `CreateCategoryDialog` components.
 * All mutations route through {@link categoriesApi}; refresh always
 * re-fetches so the server-side `createdAt` / `updatedAt` stay
 * authoritative.
 */

import { onMounted, reactive, ref } from 'vue';
import { ElButton, ElMessage, ElMessageBox } from 'element-plus';

import CategoryTable from './categories/components/CategoryTable.vue';
import CreateCategoryDialog from './categories/components/CreateCategoryDialog.vue';
import { useCategories } from './categories/hooks/useCategories.js';
import type { AdminCategoryView } from '../api/catalog.js';
import type {
  CategoryFormShape,
  CategoryInlineEdit,
} from './categories/type/form.js';

const {
  categories,
  loading,
  lastError,
  editingId,
  editingDraft,
  refresh,
  blankForm,
  startEdit,
  cancelEdit,
  saveEdit,
  create,
  remove,
  toggleActive,
} = useCategories();

const dialogOpen = ref(false);
const submitting = ref(false);
const dialogForm = reactive<CategoryFormShape>({
  name: '',
  imageUrl: '',
  sortOrder: 0,
  isActive: true,
});

onMounted(refresh);

function patchDraft(patch: Partial<CategoryInlineEdit>): void {
  Object.assign(editingDraft, patch);
}

function patchForm(patch: Partial<CategoryFormShape>): void {
  Object.assign(dialogForm, patch);
}

function openCreateDialog(): void {
  const blank = blankForm();
  dialogForm.name = blank.name;
  dialogForm.imageUrl = blank.imageUrl;
  dialogForm.sortOrder = blank.sortOrder;
  dialogForm.isActive = blank.isActive;
  dialogOpen.value = true;
}

async function onSubmitCreate(): Promise<void> {
  submitting.value = true;
  try {
    await create({
      name: dialogForm.name,
      imageUrl: dialogForm.imageUrl,
      sortOrder: dialogForm.sortOrder,
      isActive: dialogForm.isActive,
    });
    ElMessage.success('分类已创建');
    dialogOpen.value = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建失败';
    ElMessage.error(message);
  } finally {
    submitting.value = false;
  }
}

async function onSaveEdit(category: AdminCategoryView): Promise<void> {
  try {
    await saveEdit(category);
    ElMessage.success('分类已更新');
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新失败';
    ElMessage.error(message);
  }
}

async function onToggleActive(category: AdminCategoryView): Promise<void> {
  try {
    await toggleActive(category);
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新失败';
    ElMessage.error(message);
  }
}

async function onRemove(category: AdminCategoryView): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除分类 “${category.name}” 吗?该操作不可撤销。`,
      '删除分类',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    );
  } catch {
    return;
  }
  try {
    await remove(category);
    ElMessage.success('分类已删除');
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除失败';
    ElMessage.error(message);
  }
}

void lastError;
</script>

<template>
  <section class="categories">
    <header class="categories__head">
      <div>
        <h1>分类管理</h1>
        <p>单层分类:名称、图片、排序、启用状态。</p>
      </div>
      <ElButton
        type="primary"
        :data-testid="'new-category'"
        @click="openCreateDialog"
      >
        新增分类
      </ElButton>
    </header>

    <CategoryTable
      :categories="categories"
      :loading="loading"
      :editing-id="editingId"
      :draft="editingDraft"
      @update:draft="patchDraft"
      @start-edit="startEdit"
      @cancel-edit="cancelEdit"
      @save-edit="onSaveEdit"
      @toggle-active="onToggleActive"
      @remove="onRemove"
    />

    <CreateCategoryDialog
      v-model:open="dialogOpen"
      :form="dialogForm"
      :submitting="submitting"
      @update:form="patchForm"
      @submit="onSubmitCreate"
    />
  </section>
</template>

<style scoped>
.categories {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.categories__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.categories__head h1 {
  margin: 0;
  font-size: 22px;
  color: #2f2a3d;
}

.categories__head p {
  margin: 4px 0 0;
  color: #8a83a3;
  font-size: 13px;
}
</style>
