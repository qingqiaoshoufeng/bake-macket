<script setup lang="ts">
import { BooleanFilter, MembershipLevelStatus } from '@bake-mall/contracts';
import {
  ElDatePicker,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
} from 'element-plus';
import { computed } from 'vue';

import AdminFilterPanel from '../../../components/filters/AdminFilterPanel.vue';
import { countActiveFilters } from '../../../utils/list-query.js';
import { MEMBERSHIP_THEME_OPTIONS } from '../config/themes.js';
import type { MembershipCardFilters } from '../type/index.js';

const props = defineProps<{
  filters: MembershipCardFilters;
  loading: boolean;
}>();
const emit = defineEmits<{
  change: [value: Partial<MembershipCardFilters>];
  search: [];
  reset: [];
}>();

const advancedCount = computed(() =>
  countActiveFilters({
    minPriceYuan: props.filters.minPriceYuan,
    maxPriceYuan: props.filters.maxPriceYuan,
    minDiscountText: props.filters.minDiscountText,
    maxDiscountText: props.filters.maxDiscountText,
    hasPurchases: props.filters.hasPurchases,
    theme: props.filters.theme,
    minValidDays: props.filters.minValidDays,
    maxValidDays: props.filters.maxValidDays,
    updatedAtRange: props.filters.updatedAtRange,
  }),
);
</script>

<template>
  <AdminFilterPanel
    :loading="loading"
    :advanced-count="advancedCount"
    @search="emit('search')"
    @reset="emit('reset')"
  >
    <ElFormItem label="关键词">
      <ElInput
        :model-value="filters.q"
        clearable
        placeholder="名称或 code"
        aria-label="搜索会员卡"
        @update:model-value="emit('change', { q: String($event) })"
        @keyup.enter="emit('search')"
      />
    </ElFormItem>
    <ElFormItem label="状态">
      <ElSelect
        :model-value="filters.status"
        clearable
        placeholder="全部状态"
        aria-label="筛选会员卡状态"
        @update:model-value="emit('change', { status: $event || '' })"
      >
        <ElOption label="已上架" :value="MembershipLevelStatus.ACTIVE" />
        <ElOption label="下架草稿" :value="MembershipLevelStatus.INACTIVE" />
      </ElSelect>
    </ElFormItem>
    <ElFormItem label="等级 rank">
      <ElInputNumber
        :model-value="filters.rank"
        :min="0"
        :precision="0"
        controls-position="right"
        aria-label="筛选会员卡 rank"
        @update:model-value="emit('change', { rank: $event })"
      />
    </ElFormItem>

    <template #advanced>
      <ElFormItem label="最低价格（元）">
        <ElInput
          :model-value="filters.minPriceYuan"
          placeholder="如 99.00"
          @update:model-value="emit('change', { minPriceYuan: String($event) })"
        />
      </ElFormItem>
      <ElFormItem label="最高价格（元）">
        <ElInput
          :model-value="filters.maxPriceYuan"
          placeholder="如 299.00"
          @update:model-value="emit('change', { maxPriceYuan: String($event) })"
        />
      </ElFormItem>
      <ElFormItem label="最低折扣（折）">
        <ElInput
          :model-value="filters.minDiscountText"
          placeholder="如 8.8"
          @update:model-value="
            emit('change', { minDiscountText: String($event) })
          "
        />
      </ElFormItem>
      <ElFormItem label="最高折扣（折）">
        <ElInput
          :model-value="filters.maxDiscountText"
          placeholder="如 9.8"
          @update:model-value="
            emit('change', { maxDiscountText: String($event) })
          "
        />
      </ElFormItem>
      <ElFormItem label="销售记录">
        <ElSelect
          :model-value="filters.hasPurchases"
          clearable
          placeholder="全部"
          @update:model-value="emit('change', { hasPurchases: $event || '' })"
        >
          <ElOption label="已有销售" :value="BooleanFilter.YES" />
          <ElOption label="尚未销售" :value="BooleanFilter.NO" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="卡面主题">
        <ElSelect
          :model-value="filters.theme"
          clearable
          placeholder="全部主题"
          @update:model-value="emit('change', { theme: $event || '' })"
        >
          <ElOption
            v-for="option in MEMBERSHIP_THEME_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="最短有效期（天）">
        <ElInputNumber
          :model-value="filters.minValidDays"
          :min="1"
          :precision="0"
          controls-position="right"
          @update:model-value="emit('change', { minValidDays: $event })"
        />
      </ElFormItem>
      <ElFormItem label="最长有效期（天）">
        <ElInputNumber
          :model-value="filters.maxValidDays"
          :min="1"
          :precision="0"
          controls-position="right"
          @update:model-value="emit('change', { maxValidDays: $event })"
        />
      </ElFormItem>
      <ElFormItem label="更新时间">
        <ElDatePicker
          :model-value="
            filters.updatedAtRange ? [...filters.updatedAtRange] : null
          "
          type="datetimerange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          @update:model-value="emit('change', { updatedAtRange: $event })"
        />
      </ElFormItem>
    </template>
  </AdminFilterPanel>
</template>
