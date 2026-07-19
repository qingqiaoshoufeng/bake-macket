<script setup lang="ts">
import { FulfillmentType, OrderStatus } from '@bake-mall/contracts';
import {
  ElButton,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
} from 'element-plus';

import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
} from '../../../constants/labels.js';
import type { OrderFilterForm } from '../type/index.js';

const props = defineProps<{ filters: OrderFilterForm; loading: boolean }>();
const emit = defineEmits<{
  change: [value: Partial<OrderFilterForm>];
  search: [];
  reset: [];
}>();
</script>

<template>
  <ElForm class="order-filters">
    <ElFormItem label="订单号">
      <ElInput
        :model-value="props.filters.orderNo"
        clearable
        placeholder="输入订单号"
        @update:model-value="emit('change', { orderNo: $event })"
        @keyup.enter="emit('search')"
      />
    </ElFormItem>
    <ElFormItem label="状态">
      <ElSelect
        :model-value="props.filters.status"
        clearable
        placeholder="全部状态"
        @update:model-value="emit('change', { status: $event })"
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
        @update:model-value="emit('change', { fulfillmentType: $event })"
      >
        <ElOption
          v-for="type in Object.values(FulfillmentType)"
          :key="type"
          :label="FULFILLMENT_LABELS[type]"
          :value="type"
        />
      </ElSelect>
    </ElFormItem>
    <ElFormItem label="下单时间" class="order-filters__date">
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
    <ElFormItem class="order-filters__actions">
      <ElButton type="primary" :loading="loading" @click="emit('search')">
        查询
      </ElButton>
      <ElButton :disabled="loading" @click="emit('reset')">重置</ElButton>
    </ElFormItem>
  </ElForm>
</template>

<style scoped>
.order-filters {
  display: grid;
  grid-template-columns:
    minmax(180px, 1.2fr)
    minmax(140px, 0.8fr)
    minmax(140px, 0.8fr)
    minmax(300px, 1.6fr)
    auto;
  gap: 14px 16px;
  width: 100%;
}

.order-filters :deep(.el-form-item) {
  display: grid;
  gap: 7px;
  margin: 0;
}

.order-filters :deep(.el-form-item__label) {
  height: auto;
  line-height: 1.4;
}

.order-filters :deep(.el-input),
.order-filters :deep(.el-select),
.order-filters :deep(.el-date-editor) {
  width: 100%;
}

.order-filters__actions {
  align-content: end;
}

.order-filters__actions :deep(.el-form-item__content) {
  flex-wrap: nowrap;
}

@media (max-width: 1240px) {
  .order-filters {
    grid-template-columns: repeat(3, minmax(160px, 1fr));
  }

  .order-filters__date {
    grid-column: span 2;
  }
}

@media (max-width: 1024px) {
  .order-filters {
    grid-template-columns: repeat(2, minmax(180px, 1fr));
  }

  .order-filters__date {
    grid-column: 1 / -1;
  }
}
</style>
