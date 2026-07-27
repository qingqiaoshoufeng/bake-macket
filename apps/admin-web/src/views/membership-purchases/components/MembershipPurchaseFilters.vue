<script setup lang="ts">
import {
  BooleanFilter,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
} from '@bake-mall/contracts';
import {
  ElDatePicker,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
} from 'element-plus';
import { computed } from 'vue';

import AdminFilterPanel from '../../../components/filters/AdminFilterPanel.vue';
import {
  MEMBERSHIP_PAYMENT_STATUS_LABELS,
  MEMBERSHIP_PURCHASE_STATUS_LABELS,
} from '../../../constants/labels.js';
import { countActiveFilters } from '../../../utils/list-query.js';
import type {
  MembershipLevelOption,
  MembershipPurchaseFilterForm,
} from '../type/index.js';

const props = defineProps<{
  filters: MembershipPurchaseFilterForm;
  loading: boolean;
  levelOptions: readonly MembershipLevelOption[];
}>();
const emit = defineEmits<{
  change: [value: Partial<MembershipPurchaseFilterForm>];
  search: [];
  reset: [];
}>();

const advancedCount = computed(() =>
  countActiveFilters({
    paymentStatus: props.filters.paymentStatus,
    minPriceYuan: props.filters.minPriceYuan,
    maxPriceYuan: props.filters.maxPriceYuan,
    voidable: props.filters.voidable,
    createdAtRange: props.filters.createdAtRange,
    paidAtRange: props.filters.paidAtRange,
    voidedAtRange: props.filters.voidedAtRange,
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
    <ElFormItem label="购卡单号">
      <ElInput
        :model-value="filters.purchaseNo"
        clearable
        placeholder="输入购卡单号"
        aria-label="筛选购卡单号"
        @update:model-value="emit('change', { purchaseNo: String($event) })"
        @keyup.enter="emit('search')"
      />
    </ElFormItem>
    <ElFormItem label="用户手机号">
      <ElInput
        :model-value="filters.userPhone"
        clearable
        placeholder="输入手机号"
        aria-label="筛选用户手机号"
        @update:model-value="emit('change', { userPhone: String($event) })"
        @keyup.enter="emit('search')"
      />
    </ElFormItem>
    <ElFormItem label="会员等级">
      <ElSelect
        :model-value="filters.levelId"
        clearable
        filterable
        placeholder="全部等级"
        aria-label="筛选会员等级"
        @update:model-value="emit('change', { levelId: $event || '' })"
      >
        <ElOption
          v-for="option in levelOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </ElSelect>
    </ElFormItem>
    <ElFormItem label="购卡状态">
      <ElSelect
        :model-value="filters.status"
        clearable
        placeholder="全部购卡状态"
        aria-label="筛选购卡状态"
        @update:model-value="emit('change', { status: $event || '' })"
      >
        <ElOption
          v-for="status in Object.values(MembershipPurchaseStatus)"
          :key="status"
          :label="MEMBERSHIP_PURCHASE_STATUS_LABELS[status]"
          :value="status"
        />
      </ElSelect>
    </ElFormItem>

    <template #advanced>
      <ElFormItem label="支付状态">
        <ElSelect
          :model-value="filters.paymentStatus"
          clearable
          placeholder="全部支付状态"
          aria-label="筛选支付状态"
          @update:model-value="emit('change', { paymentStatus: $event || '' })"
        >
          <ElOption
            v-for="status in Object.values(MembershipPaymentStatus)"
            :key="status"
            :label="MEMBERSHIP_PAYMENT_STATUS_LABELS[status]"
            :value="status"
          />
        </ElSelect>
      </ElFormItem>
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
      <ElFormItem label="可作废">
        <ElSelect
          :model-value="filters.voidable"
          clearable
          placeholder="全部"
          @update:model-value="emit('change', { voidable: $event || '' })"
        >
          <ElOption label="可作废" :value="BooleanFilter.YES" />
          <ElOption label="不可作废" :value="BooleanFilter.NO" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="创建时间">
        <ElDatePicker
          :model-value="
            filters.createdAtRange ? [...filters.createdAtRange] : null
          "
          type="datetimerange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          aria-label="筛选购卡创建时间"
          @update:model-value="emit('change', { createdAtRange: $event })"
        />
      </ElFormItem>
      <ElFormItem label="支付时间">
        <ElDatePicker
          :model-value="filters.paidAtRange ? [...filters.paidAtRange] : null"
          type="datetimerange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          aria-label="筛选购卡支付时间"
          @update:model-value="emit('change', { paidAtRange: $event })"
        />
      </ElFormItem>
      <ElFormItem label="作废时间">
        <ElDatePicker
          :model-value="
            filters.voidedAtRange ? [...filters.voidedAtRange] : null
          "
          type="datetimerange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          aria-label="筛选购卡作废时间"
          @update:model-value="emit('change', { voidedAtRange: $event })"
        />
      </ElFormItem>
    </template>
  </AdminFilterPanel>
</template>
