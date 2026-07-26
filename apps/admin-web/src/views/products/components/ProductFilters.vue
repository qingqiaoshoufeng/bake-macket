<script setup lang="ts">
import {
  BooleanFilter,
  ProductStockFilter,
  type AdminCategoryView,
} from '@bake-mall/contracts';
import {
  ElDatePicker,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
} from 'element-plus';

import AdminFilterPanel from '../../../components/filters/AdminFilterPanel.vue';
import type { ProductFilterForm } from '../type/list.js';

const props = defineProps<{
  filters: ProductFilterForm;
  categories: readonly AdminCategoryView[];
  loading: boolean;
  advancedCount: number;
}>();

const emit = defineEmits<{
  change: [patch: Partial<ProductFilterForm>];
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
    <el-form-item label="商品名称">
      <el-input
        :model-value="props.filters.q"
        clearable
        placeholder="输入商品名称"
        @update:model-value="emit('change', { q: String($event) })"
      />
    </el-form-item>
    <el-form-item label="分类">
      <el-select
        :model-value="props.filters.categoryId"
        clearable
        filterable
        placeholder="全部分类"
        @update:model-value="
          emit('change', { categoryId: String($event ?? '') })
        "
      >
        <el-option
          v-for="category in props.categories"
          :key="category.id"
          :label="category.name"
          :value="category.id"
        />
      </el-select>
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

    <template #advanced>
      <el-form-item label="SKU 可用状态">
        <el-select
          :model-value="props.filters.hasActiveSku"
          clearable
          placeholder="全部"
          @update:model-value="emit('change', { hasActiveSku: $event })"
        >
          <el-option
            v-for="option in booleanOptions"
            :key="option.value"
            :label="
              option.value === BooleanFilter.YES ? '有可用 SKU' : '无可用 SKU'
            "
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="库存状态">
        <el-select
          :model-value="props.filters.stock"
          clearable
          placeholder="全部库存"
          @update:model-value="emit('change', { stock: $event })"
        >
          <el-option label="有库存" :value="ProductStockFilter.IN_STOCK" />
          <el-option
            label="低库存（≤ 10）"
            :value="ProductStockFilter.LOW_STOCK"
          />
          <el-option label="缺货" :value="ProductStockFilter.OUT_OF_STOCK" />
        </el-select>
      </el-form-item>
      <el-form-item label="是否有主图">
        <el-select
          :model-value="props.filters.hasCoverImage"
          clearable
          placeholder="全部"
          @update:model-value="emit('change', { hasCoverImage: $event })"
        >
          <el-option
            v-for="option in booleanOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="最低 SKU 售价（元）">
        <el-input
          :model-value="props.filters.minPriceYuan"
          inputmode="decimal"
          placeholder="例如 19.90"
          @update:model-value="emit('change', { minPriceYuan: String($event) })"
        />
      </el-form-item>
      <el-form-item label="最高 SKU 售价（元）">
        <el-input
          :model-value="props.filters.maxPriceYuan"
          inputmode="decimal"
          placeholder="例如 199.00"
          @update:model-value="emit('change', { maxPriceYuan: String($event) })"
        />
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
