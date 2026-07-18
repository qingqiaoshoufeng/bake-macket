<script setup lang="ts">
import type { AdminProductSummaryView } from '@bake-mall/contracts';
import { ElButton, ElImage, ElTable, ElTableColumn, ElTag } from 'element-plus';

import { PRODUCT_COLUMNS } from '../config/columns.js';

const props = defineProps<{
  products: readonly AdminProductSummaryView[];
  loading: boolean;
  deletingId: string | null;
}>();

const emit = defineEmits<{
  edit: [id: string];
  remove: [id: string];
}>();

const [
  nameColumn,
  categoryColumn,
  coverImageColumn,
  activeSkuCountColumn,
  sortOrderColumn,
  statusColumn,
  actionsColumn,
] = PRODUCT_COLUMNS;

void props;
</script>

<template>
  <ElTable
    :data="[...products]"
    row-key="id"
    :empty-text="loading ? '加载中…' : '暂无商品'"
    :data-testid="'products-table'"
  >
    <ElTableColumn :label="nameColumn.label" :min-width="nameColumn.minWidth">
      <template #default="{ row }">{{ row.name }}</template>
    </ElTableColumn>
    <ElTableColumn
      :label="categoryColumn.label"
      :min-width="categoryColumn.minWidth"
    >
      <template #default="{ row }">{{ row.categoryName }}</template>
    </ElTableColumn>
    <ElTableColumn
      :label="coverImageColumn.label"
      :width="coverImageColumn.width"
    >
      <template #default="{ row }">
        <ElImage
          v-if="row.coverImage"
          :src="row.coverImage.publicUrl"
          fit="cover"
          class="product-table__image"
          :alt="row.name"
        />
        <span v-else>无主图</span>
      </template>
    </ElTableColumn>
    <ElTableColumn
      :label="activeSkuCountColumn.label"
      :width="activeSkuCountColumn.width"
    >
      <template #default="{ row }">{{ row.activeSkuCount }}</template>
    </ElTableColumn>
    <ElTableColumn
      :label="sortOrderColumn.label"
      :width="sortOrderColumn.width"
    >
      <template #default="{ row }">{{ row.sortOrder }}</template>
    </ElTableColumn>
    <ElTableColumn :label="statusColumn.label" :width="statusColumn.width">
      <template #default="{ row }">
        <ElTag :type="row.isActive ? 'success' : 'info'">
          {{ row.isActive ? '上架' : '下架' }}
        </ElTag>
      </template>
    </ElTableColumn>
    <ElTableColumn :label="actionsColumn.label" :width="actionsColumn.width">
      <template #default="{ row }">
        <ElButton
          size="small"
          :data-testid="`edit-product-${row.id}`"
          @click="emit('edit', row.id)"
        >
          编辑
        </ElButton>
        <ElButton
          size="small"
          type="danger"
          :loading="deletingId === row.id"
          :data-testid="`remove-product-${row.id}`"
          @click="emit('remove', row.id)"
        >
          删除
        </ElButton>
      </template>
    </ElTableColumn>
  </ElTable>
</template>

<style scoped>
.product-table__image {
  width: 48px;
  height: 48px;
  border-radius: 8px;
}
</style>
