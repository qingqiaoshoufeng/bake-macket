<script setup lang="ts">
/**
 * Category management table (purely presentational).
 *
 * Renders the editable rows + inline edit draft hook binding. It owns
 * no business state — every action delegates to the parent through
 * emitted events. Sub-component props stay here and are NOT lifted into
 * `type/`.
 */

import {
  ElButton,
  ElInput,
  ElInputNumber,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus';

import AdminEmptyState from '../../../components/feedback/AdminEmptyState.vue';
import { CATEGORY_COLUMNS } from '../config/columns.js';
import { ACTIVE_LABEL, INACTIVE_LABEL } from '../config/defaults.js';
import type { AdminCategoryView } from '@bake-mall/contracts';
import type { CategoryInlineEdit } from '../type/form.js';

const props = defineProps<{
  categories: readonly AdminCategoryView[];
  loading: boolean;
  editingId: string | null;
  draft: CategoryInlineEdit;
  hasAppliedFilters?: boolean;
}>();

const emit = defineEmits<{
  'update:draft': [patch: Partial<CategoryInlineEdit>];
  'start-edit': [category: AdminCategoryView];
  'cancel-edit': [];
  'save-edit': [category: AdminCategoryView];
  'toggle-active': [category: AdminCategoryView];
  remove: [category: AdminCategoryView];
}>();

const [
  nameColumn,
  imageColumn,
  sortOrderColumn,
  activeColumn,
  statusColumn,
  actionsColumn,
] = CATEGORY_COLUMNS;

void props;

function asCategory(row: unknown): AdminCategoryView {
  return row as AdminCategoryView;
}
</script>

<template>
  <ElTable
    v-loading="loading"
    :data="[...categories]"
    row-key="id"
    height="100%"
    class="admin-table category-table"
    :empty-text="'暂无分类，先创建一个商品分类'"
    :data-testid="'categories-table'"
  >
    <ElTableColumn :label="nameColumn.label" :min-width="nameColumn.minWidth">
      <template #default="{ row }">
        <template v-if="editingId === row.id">
          <ElInput
            :model-value="draft.name"
            size="small"
            :data-testid="`edit-name-${row.id}`"
            @update:model-value="
              (v) => emit('update:draft', { name: String(v) })
            "
          />
        </template>
        <template v-else>
          {{ row.name }}
        </template>
      </template>
    </ElTableColumn>

    <ElTableColumn :label="imageColumn.label" :min-width="imageColumn.minWidth">
      <template #default="{ row }">
        <template v-if="editingId === row.id">
          <ElInput
            :model-value="draft.imageUrl"
            size="small"
            placeholder="https://..."
            :data-testid="`edit-image-${row.id}`"
            @update:model-value="
              (v) => emit('update:draft', { imageUrl: String(v) })
            "
          />
        </template>
        <template v-else>
          <a
            v-if="row.imageUrl"
            :href="row.imageUrl"
            target="_blank"
            rel="noopener"
            :data-testid="`category-image-${row.id}`"
          >
            {{ row.imageUrl }}
          </a>
          <ElTag v-else type="info" :data-testid="`category-no-image-${row.id}`"
            >无图</ElTag
          >
        </template>
      </template>
    </ElTableColumn>

    <ElTableColumn
      :label="sortOrderColumn.label"
      :width="sortOrderColumn.width"
    >
      <template #default="{ row }">
        <template v-if="editingId === row.id">
          <ElInputNumber
            :model-value="draft.sortOrder"
            size="small"
            :min="0"
            :data-testid="`edit-sort-${row.id}`"
            @update:model-value="
              (v) => emit('update:draft', { sortOrder: Number(v ?? 0) })
            "
          />
        </template>
        <template v-else>
          {{ row.sortOrder }}
        </template>
      </template>
    </ElTableColumn>

    <ElTableColumn :label="activeColumn.label" :width="activeColumn.width">
      <template #default="{ row }">
        <ElSwitch
          :model-value="row.isActive"
          :disabled="editingId === row.id"
          :data-testid="`category-active-${row.id}`"
          @change="() => emit('toggle-active', asCategory(row))"
        />
      </template>
    </ElTableColumn>

    <ElTableColumn :label="statusColumn.label" :width="statusColumn.width">
      <template #default="{ row }">
        <ElTag
          :type="row.isActive ? 'success' : 'info'"
          :data-testid="`category-status-${row.id}`"
        >
          {{ row.isActive ? ACTIVE_LABEL : INACTIVE_LABEL }}
        </ElTag>
      </template>
    </ElTableColumn>

    <template #empty>
      <AdminEmptyState
        :title="hasAppliedFilters ? '当前筛选无结果' : '暂无分类'"
        :description="
          hasAppliedFilters
            ? '请调整筛选条件后重新查询。'
            : '先创建一个分类，再为商品安排归属。'
        "
        tone="mint"
      />
    </template>

    <ElTableColumn
      :label="actionsColumn.label"
      :width="actionsColumn.width"
      :align="actionsColumn.align"
      fixed="right"
    >
      <template #default="{ row }">
        <template v-if="editingId === row.id">
          <ElButton
            size="small"
            type="primary"
            :data-testid="`save-${row.id}`"
            @click="emit('save-edit', asCategory(row))"
          >
            保存
          </ElButton>
          <ElButton
            size="small"
            :data-testid="`cancel-${row.id}`"
            @click="emit('cancel-edit')"
          >
            取消
          </ElButton>
        </template>
        <template v-else>
          <ElButton
            size="small"
            :data-testid="`edit-${row.id}`"
            @click="emit('start-edit', asCategory(row))"
          >
            编辑
          </ElButton>
          <ElButton
            size="small"
            type="danger"
            :data-testid="`delete-${row.id}`"
            @click="emit('remove', asCategory(row))"
          >
            删除
          </ElButton>
        </template>
      </template>
    </ElTableColumn>
  </ElTable>
</template>

<style scoped>
.category-table {
  height: 100%;
  min-height: 0;
}

:deep(.admin-row) td {
  vertical-align: middle;
}
</style>
