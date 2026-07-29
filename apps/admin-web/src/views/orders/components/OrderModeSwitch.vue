<script setup lang="ts">
import { AdminOrderExportView } from '@bake-mall/contracts';
import { ElButton, ElRadioButton, ElRadioGroup } from 'element-plus';

const props = defineProps<{
  modelValue: AdminOrderExportView;
  exporting: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: AdminOrderExportView];
  export: [];
}>();

function changeMode(value: string | number | boolean | undefined): void {
  if (
    value === AdminOrderExportView.ORDER ||
    value === AdminOrderExportView.SUPPLY
  ) {
    emit('update:modelValue', value);
  }
}
</script>

<template>
  <div class="order-mode-switch">
    <ElRadioGroup
      :model-value="props.modelValue"
      aria-label="订单展示模式"
      @update:model-value="changeMode"
    >
      <ElRadioButton
        :value="AdminOrderExportView.ORDER"
        data-testid="order-mode"
      >
        订单模式
      </ElRadioButton>
      <ElRadioButton
        :value="AdminOrderExportView.SUPPLY"
        data-testid="supply-mode"
      >
        SKU 供货模式
      </ElRadioButton>
    </ElRadioGroup>
    <ElButton
      type="primary"
      :loading="props.exporting"
      :disabled="props.exporting"
      data-testid="export-orders"
      @click="emit('export')"
    >
      导出 Excel
    </ElButton>
  </div>
</template>

<style scoped>
.order-mode-switch {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
