<script setup lang="ts">
import { BannerTargetType, BooleanFilter } from '@bake-mall/contracts';
import {
  ElDatePicker,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
} from 'element-plus';

import AdminFilterPanel from '../../../components/filters/AdminFilterPanel.vue';
import type { BannerTargetOption } from '../type/form.js';
import type { BannerFilterForm } from '../type/list.js';

const props = defineProps<{
  filters: BannerFilterForm;
  targetOptions: readonly BannerTargetOption[];
  loading: boolean;
  advancedCount: number;
}>();

const emit = defineEmits<{
  change: [patch: Partial<BannerFilterForm>];
  'target-type-change': [value: '' | BannerTargetType];
  search: [];
  reset: [];
}>();

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
    <el-form-item label="标题关键字">
      <el-input
        :model-value="props.filters.q"
        clearable
        placeholder="输入 Banner 标题"
        @update:model-value="emit('change', { q: String($event) })"
      />
    </el-form-item>
    <el-form-item label="上架状态">
      <el-select
        :model-value="props.filters.isActive"
        clearable
        placeholder="全部状态"
        @update:model-value="emit('change', { isActive: $event })"
      >
        <el-option label="已上架" :value="BooleanFilter.YES" />
        <el-option label="已下架" :value="BooleanFilter.NO" />
      </el-select>
    </el-form-item>
    <el-form-item label="跳转类型">
      <el-select
        :model-value="props.filters.targetType"
        clearable
        placeholder="全部类型"
        @update:model-value="emit('target-type-change', $event)"
      >
        <el-option label="无跳转" :value="BannerTargetType.NONE" />
        <el-option label="商品" :value="BannerTargetType.PRODUCT" />
        <el-option label="分类" :value="BannerTargetType.CATEGORY" />
      </el-select>
    </el-form-item>

    <template #advanced>
      <el-form-item label="跳转目标">
        <el-select
          :model-value="props.filters.targetId"
          :disabled="
            !props.filters.targetType ||
            props.filters.targetType === BannerTargetType.NONE
          "
          clearable
          filterable
          placeholder="先选择跳转类型"
          @update:model-value="
            emit('change', { targetId: String($event ?? '') })
          "
        >
          <el-option
            v-for="option in props.targetOptions"
            :key="option.id"
            :label="option.label"
            :value="option.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="目标是否有效">
        <el-select
          :model-value="props.filters.targetValid"
          clearable
          placeholder="全部"
          @update:model-value="emit('change', { targetValid: $event })"
        >
          <el-option label="有效" :value="BooleanFilter.YES" />
          <el-option label="已失效" :value="BooleanFilter.NO" />
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
