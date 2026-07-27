<script setup lang="ts">
import {
  BooleanFilter,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';
import {
  ElDatePicker,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
} from 'element-plus';

import AdminFilterPanel from '../../../components/filters/AdminFilterPanel.vue';
import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
} from '../../../constants/labels.js';
import type { OrderFilterForm } from '../type/index.js';

const props = defineProps<{
  filters: OrderFilterForm;
  loading: boolean;
  advancedCount: number;
}>();
const emit = defineEmits<{
  change: [value: Partial<OrderFilterForm>];
  search: [];
  reset: [];
}>();

const BOOLEAN_FILTER_LABELS: Readonly<Record<BooleanFilter, string>> = {
  [BooleanFilter.YES]: '是',
  [BooleanFilter.NO]: '否',
};

function emitText(key: keyof OrderFilterForm, value: unknown): void {
  emit('change', { [key]: String(value ?? '') });
}
</script>

<template>
  <AdminFilterPanel
    :loading="props.loading"
    :advanced-count="props.advancedCount"
    @search="emit('search')"
    @reset="emit('reset')"
  >
    <ElFormItem label="订单号">
      <ElInput
        :model-value="props.filters.orderNo"
        clearable
        placeholder="输入订单号"
        @update:model-value="emitText('orderNo', $event)"
      />
    </ElFormItem>
    <ElFormItem label="联系人 / 手机号">
      <ElInput
        :model-value="props.filters.contact"
        clearable
        placeholder="输入联系人或手机号"
        @update:model-value="emitText('contact', $event)"
      />
    </ElFormItem>
    <ElFormItem label="状态">
      <ElSelect
        :model-value="props.filters.status"
        clearable
        placeholder="全部状态"
        @update:model-value="emit('change', { status: $event || '' })"
      >
        <ElOption
          v-for="status in Object.values(OrderStatus)"
          :key="status"
          :label="ORDER_STATUS_LABELS[status]"
          :value="status"
        />
      </ElSelect>
    </ElFormItem>
    <ElFormItem label="履约方式">
      <ElSelect
        :model-value="props.filters.fulfillmentType"
        clearable
        placeholder="全部方式"
        @update:model-value="emit('change', { fulfillmentType: $event || '' })"
      >
        <ElOption
          v-for="type in Object.values(FulfillmentType)"
          :key="type"
          :label="FULFILLMENT_LABELS[type]"
          :value="type"
        />
      </ElSelect>
    </ElFormItem>

    <template #advanced>
      <ElFormItem label="用户 ID">
        <ElInput
          :model-value="props.filters.userId"
          clearable
          placeholder="输入用户 ID"
          @update:model-value="emitText('userId', $event)"
        />
      </ElFormItem>
      <ElFormItem label="商品 / SKU">
        <ElInput
          :model-value="props.filters.itemQ"
          clearable
          placeholder="输入商品或 SKU"
          @update:model-value="emitText('itemQ', $event)"
        />
      </ElFormItem>
      <ElFormItem label="是否会员">
        <ElSelect
          :model-value="props.filters.usesMembership"
          clearable
          placeholder="全部"
          @update:model-value="emit('change', { usesMembership: $event || '' })"
        >
          <ElOption
            v-for="value in Object.values(BooleanFilter)"
            :key="value"
            :label="BOOLEAN_FILTER_LABELS[value]"
            :value="value"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="是否消费金">
        <ElSelect
          :model-value="props.filters.usesCredit"
          clearable
          placeholder="全部"
          @update:model-value="emit('change', { usesCredit: $event || '' })"
        >
          <ElOption
            v-for="value in Object.values(BooleanFilter)"
            :key="value"
            :label="BOOLEAN_FILTER_LABELS[value]"
            :value="value"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="有无备注">
        <ElSelect
          :model-value="props.filters.hasRemark"
          clearable
          placeholder="全部"
          @update:model-value="emit('change', { hasRemark: $event || '' })"
        >
          <ElOption
            v-for="value in Object.values(BooleanFilter)"
            :key="value"
            :label="BOOLEAN_FILTER_LABELS[value]"
            :value="value"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="最低应付（元）">
        <ElInput
          :model-value="props.filters.minPayableYuan"
          clearable
          inputmode="decimal"
          placeholder="例如 10.00"
          @update:model-value="emitText('minPayableYuan', $event)"
        />
      </ElFormItem>
      <ElFormItem label="最高应付（元）">
        <ElInput
          :model-value="props.filters.maxPayableYuan"
          clearable
          inputmode="decimal"
          placeholder="例如 100.00"
          @update:model-value="emitText('maxPayableYuan', $event)"
        />
      </ElFormItem>
      <ElFormItem label="下单时间">
        <ElDatePicker
          :model-value="
            props.filters.createdAtRange
              ? [...props.filters.createdAtRange]
              : null
          "
          type="datetimerange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          @update:model-value="emit('change', { createdAtRange: $event })"
        />
      </ElFormItem>
    </template>
  </AdminFilterPanel>
</template>
