<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus';

import {
  adminCatalogApi,
  type AdminCategoryView,
  type CreateCategoryRequest,
} from '../api/catalog.js';

/**
 * Category management surface (Task 12).
 *
 * Single-level categories only — the design spec does not allow nested
 * taxonomies. The view renders an Element Plus table whose rows can be:
 *
 * - created via a dedicated dialog;
 * - edited inline (name, sort order, image URL, active toggle) — the row
 *   flips into "editing" mode on click of the edit button;
 * - activated / deactivated through the same toggle, which issues a
 *   `PATCH /admin/categories/:id` with the new `isActive` flag.
 *
 * All mutations route through {@link adminCatalogApi}. The view never
 * directly mutates the underlying rows; refresh always re-fetches so the
 * server-side `createdAt` / `updatedAt` are authoritative.
 */

const categories = ref<AdminCategoryView[]>([]);
const loading = ref(false);

const dialogOpen = ref(false);
const submitting = ref(false);
const dialogForm = reactive<CreateCategoryRequest & { isActive: boolean }>({
  name: '',
  imageUrl: '',
  sortOrder: 0,
  isActive: true,
});

const editingId = ref<string | null>(null);
const editingDraft = reactive<{
  name: string;
  sortOrder: number;
  imageUrl: string;
  isActive: boolean;
}>({
  name: '',
  sortOrder: 0,
  imageUrl: '',
  isActive: true,
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    categories.value = await adminCatalogApi.listCategories();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '分类加载失败';
    ElMessage.error(message);
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

function openCreateDialog(): void {
  dialogForm.name = '';
  dialogForm.imageUrl = '';
  dialogForm.sortOrder = categories.value.length;
  dialogForm.isActive = true;
  dialogOpen.value = true;
}

async function submitCreate(): Promise<void> {
  if (!dialogForm.name.trim()) {
    ElMessage.warning('请输入分类名称');
    return;
  }
  submitting.value = true;
  try {
    const body: CreateCategoryRequest = {
      name: dialogForm.name.trim(),
      isActive: dialogForm.isActive,
      sortOrder: dialogForm.sortOrder,
    };
    if (dialogForm.imageUrl.trim()) {
      body.imageUrl = dialogForm.imageUrl.trim();
    }
    await adminCatalogApi.createCategory(body);
    ElMessage.success('分类已创建');
    dialogOpen.value = false;
    await refresh();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '创建失败';
    ElMessage.error(message);
  } finally {
    submitting.value = false;
  }
}

function startEdit(category: AdminCategoryView): void {
  editingId.value = category.id;
  editingDraft.name = category.name;
  editingDraft.sortOrder = category.sortOrder;
  editingDraft.imageUrl = category.imageUrl ?? '';
  editingDraft.isActive = category.isActive;
}

function cancelEdit(): void {
  editingId.value = null;
}

async function saveEdit(category: AdminCategoryView): Promise<void> {
  if (!editingDraft.name.trim()) {
    ElMessage.warning('分类名称不能为空');
    return;
  }
  try {
    await adminCatalogApi.updateCategory(category.id, {
      name: editingDraft.name.trim(),
      sortOrder: editingDraft.sortOrder,
      isActive: editingDraft.isActive,
      imageUrl: editingDraft.imageUrl.trim() || undefined,
    });
    ElMessage.success('分类已更新');
    editingId.value = null;
    await refresh();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '更新失败';
    ElMessage.error(message);
  }
}

async function toggleActive(category: AdminCategoryView): Promise<void> {
  try {
    await adminCatalogApi.updateCategory(category.id, {
      isActive: !category.isActive,
    });
    await refresh();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '更新失败';
    ElMessage.error(message);
  }
}

async function removeCategory(category: AdminCategoryView): Promise<void> {
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
    await adminCatalogApi.deleteCategory(category.id);
    ElMessage.success('分类已删除');
    await refresh();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '删除失败';
    ElMessage.error(message);
  }
}
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

    <ElTable
      v-loading="loading"
      :data="categories"
      :empty-text="'暂无分类'"
      :data-testid="'categories-table'"
      row-key="id"
    >
      <ElTableColumn label="名称" min-width="200">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <ElInput
              v-model="editingDraft.name"
              size="small"
              :data-testid="`edit-name-${row.id}`"
            />
          </template>
          <template v-else>
            {{ row.name }}
          </template>
        </template>
      </ElTableColumn>
      <ElTableColumn label="图标/图片" min-width="220">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <ElInput
              v-model="editingDraft.imageUrl"
              size="small"
              placeholder="https://..."
              :data-testid="`edit-image-${row.id}`"
            />
          </template>
          <template v-else>
            <a
              v-if="row.imageUrl"
              :href="row.imageUrl"
              target="_blank"
              rel="noopener"
              class="categories__image-link"
            >
              {{ row.imageUrl }}
            </a>
            <span v-else class="categories__muted">—</span>
          </template>
        </template>
      </ElTableColumn>
      <ElTableColumn label="排序" width="120">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <ElInputNumber
              v-model="editingDraft.sortOrder"
              size="small"
              :min="0"
              :data-testid="`edit-sort-${row.id}`"
            />
          </template>
          <template v-else>
            {{ row.sortOrder }}
          </template>
        </template>
      </ElTableColumn>
      <ElTableColumn label="启用" width="120">
        <template #default="{ row }">
          <ElSwitch
            :model-value="row.isActive"
            :data-testid="`active-${row.id}`"
            @update:model-value="() => toggleActive(row)"
          />
        </template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="120">
        <template #default="{ row }">
          <ElTag :type="row.isActive ? 'success' : 'info'">
            {{ row.isActive ? '已启用' : '已停用' }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <template v-if="editingId === row.id">
            <ElButton
              size="small"
              type="primary"
              :data-testid="`save-${row.id}`"
              @click="saveEdit(row)"
            >
              保存
            </ElButton>
            <ElButton size="small" @click="cancelEdit">
              取消
            </ElButton>
          </template>
          <template v-else>
            <ElButton
              size="small"
              :data-testid="`edit-${row.id}`"
              @click="startEdit(row)"
            >
              编辑
            </ElButton>
            <ElButton
              size="small"
              type="danger"
              plain
              :data-testid="`delete-${row.id}`"
              @click="removeCategory(row)"
            >
              删除
            </ElButton>
          </template>
        </template>
      </ElTableColumn>
    </ElTable>

    <ElDialog
      v-model="dialogOpen"
      title="新增分类"
      width="420px"
      :data-testid="'category-dialog'"
    >
      <ElForm label-position="top">
        <ElFormItem label="分类名称" required>
          <ElInput
            v-model="dialogForm.name"
            placeholder="例如 生日蛋糕"
            :data-testid="'dialog-name'"
          />
        </ElFormItem>
        <ElFormItem label="图标/图片 URL">
          <ElInput
            v-model="dialogForm.imageUrl"
            placeholder="https://..."
            :data-testid="'dialog-image'"
          />
        </ElFormItem>
        <ElFormItem label="排序">
          <ElInputNumber
            v-model="dialogForm.sortOrder"
            :min="0"
            :data-testid="'dialog-sort'"
          />
        </ElFormItem>
        <ElFormItem label="启用">
          <ElSwitch v-model="dialogForm.isActive" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogOpen = false">取消</ElButton>
        <ElButton
          type="primary"
          :loading="submitting"
          :data-testid="'dialog-submit'"
          @click="submitCreate"
        >
          保存
        </ElButton>
      </template>
    </ElDialog>
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

.categories__image-link {
  color: var(--el-color-primary);
  font-size: 12px;
  word-break: break-all;
}

.categories__muted {
  color: #b6aecf;
}
</style>