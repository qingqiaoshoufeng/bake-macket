<script setup lang="ts">
import { BooleanFilter } from '@bake-mall/contracts';
import {
  ElDatePicker,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
} from 'element-plus';

import AdminFilterPanel from '../../../components/filters/AdminFilterPanel.vue';
import type { CategoryFilterForm } from '../type/list.js';

const props = defineProps<{
  filters: CategoryFilterForm;
  loading: boolean;
  advancedCount: number;
}>();

const emit = defineEmits<{
  change: [patch: Partial<CategoryFilterForm>];
  search: [];
  reset: [];
}>();

const booleanOptions = [
  { label: '是', value: BooleanFilter.YES },
  { label: '否', value: BooleanFilter.NO },
] as const;

function updateRange(value: unknown): void {
  const range =
    Array.isArray(value) && value.length === 2
      ? ([String(value[0]), String(value[1])] as const)
      : null;
  emit('change', { createdAtRange: range });
}
</script>

<template>
  <AdminFilterPanel
    :loading="loading"
    :advanced-count="advancedCount"
    @search="emit('search')"
    @reset="emit('reset')"
  >
    <el-form-item label="分类名称">
      <el-input
        :model-value="props.filters.q"
        clearable
        placeholder="输入分类名称"
        @update:model-value="emit('change', { q: String($event) })"
      />
    </el-form-item>
    <el-form-item label="启用状态">
      <el-select
        :model-value="props.filters.isActive"
        clearable
        placeholder="全部状态"
        @update:model-value="emit('change', { isActive: $event })"
      >
        <el-option label="已启用" :value="BooleanFilter.YES" />
        <el-option label="已停用" :value="BooleanFilter.NO" />
      </el-select>
    </el-form-item>

    <template #advanced>
      <el-form-item label="是否有图片">
        <el-select
          :model-value="props.filters.hasImage"
          clearable
          placeholder="全部"
          @update:model-value="emit('change', { hasImage: $event })"
        >
          <el-option
            v-for="option in booleanOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="是否有关联商品">
        <el-select
          :model-value="props.filters.hasProducts"
          clearable
          placeholder="全部"
          @update:model-value="emit('change', { hasProducts: $event })"
        >
          <el-option
            v-for="option in booleanOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="创建时间" class="filter-field--wide">
        <el-date-picker
          :model-value="
            props.filters.createdAtRange
              ? [...props.filters.createdAtRange]
              : null
          "
          type="datetimerange"
          value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          @update:model-value="updateRange"
        />
      </el-form-item>
    </template>
  </AdminFilterPanel>
</template>

<style scoped>
.filter-field--wide {
  grid-column: 1 / -1;
}
</style>
