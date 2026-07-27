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

import { onMounted, reactive, ref, watch } from 'vue';
import {
  ElAlert,
  ElButton,
  ElMessage,
  ElMessageBox,
  ElPagination,
} from 'element-plus';

import AdminDataPanel from '../components/layout/AdminDataPanel.vue';
import AdminPage from '../components/layout/AdminPage.vue';
import AdminPageHeader from '../components/layout/AdminPageHeader.vue';
import CategoryFilters from './categories/components/CategoryFilters.vue';
import CategoryTable from './categories/components/CategoryTable.vue';
import CreateCategoryDialog from './categories/components/CreateCategoryDialog.vue';
import { CATEGORY_PAGINATION } from './categories/config/pagination.js';
import { useCategories } from './categories/hooks/useCategories.js';
import type { AdminCategoryView } from '../api/catalog.js';
import type {
  CategoryFormShape,
  CategoryInlineEdit,
} from './categories/type/form.js';
import type { CategoryFilterForm } from './categories/type/list.js';

const {
  categories,
  draftFilters,
  advancedCount,
  hasAppliedFilters,
  page,
  pageSize,
  total,
  loading,
  lastError,
  editingId,
  editingDraft,
  refresh,
  search,
  reset,
  setPage,
  setPageSize,
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

function showLoadError(error: string | null): void {
  if (error) {
    ElMessage.error(error);
  }
}

watch(lastError, showLoadError);

function patchDraft(patch: Partial<CategoryInlineEdit>): void {
  Object.assign(editingDraft, patch);
}

function patchFilters(patch: Partial<CategoryFilterForm>): void {
  Object.assign(draftFilters, patch);
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
</script>

<template>
  <AdminPage>
    <AdminPageHeader
      eyebrow="CATALOG"
      title="分类管理"
      description="维护单层分类的名称、图片、排序与启用状态。"
    >
      <template #actions>
        <ElButton
          type="primary"
          :data-testid="'new-category'"
          @click="openCreateDialog"
        >
          新增分类
        </ElButton>
      </template>
    </AdminPageHeader>

    <ElAlert
      v-if="lastError"
      type="error"
      :title="lastError"
      :closable="false"
      show-icon
    />

    <AdminDataPanel>
      <template #toolbar>
        <CategoryFilters
          :filters="draftFilters"
          :loading="loading"
          :advanced-count="advancedCount"
          @change="patchFilters"
          @search="search"
          @reset="reset"
        />
      </template>

      <CategoryTable
        :categories="categories"
        :loading="loading"
        :editing-id="editingId"
        :draft="editingDraft"
        :has-applied-filters="hasAppliedFilters"
        @update:draft="patchDraft"
        @start-edit="startEdit"
        @cancel-edit="cancelEdit"
        @save-edit="onSaveEdit"
        @toggle-active="onToggleActive"
        @remove="onRemove"
      />

      <template v-if="total > 0" #footer>
        <ElPagination
          background
          layout="total, sizes, prev, pager, next"
          :total="total"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[...CATEGORY_PAGINATION.pageSizes]"
          @update:current-page="setPage"
          @update:page-size="setPageSize"
        />
      </template>
    </AdminDataPanel>

    <CreateCategoryDialog
      v-model:open="dialogOpen"
      :form="dialogForm"
      :submitting="submitting"
      @update:form="patchForm"
      @submit="onSubmitCreate"
    />
  </AdminPage>
</template>
