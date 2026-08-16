<script setup lang="ts">
import type { CloudPrinterView } from '@bake-mall/contracts';
import { ElDescriptions, ElDescriptionsItem, ElDialog, ElTag } from 'element-plus';

defineProps<{
  readonly visible: boolean;
  readonly printer: CloudPrinterView | null;
}>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <ElDialog
    :model-value="visible"
    title="打印机详情"
    width="min(92vw, 560px)"
    @close="emit('close')"
  >
    <ElDescriptions v-if="printer" :column="1" border>
      <ElDescriptionsItem label="名称">{{ printer.displayName }}</ElDescriptionsItem>
      <ElDescriptionsItem label="设备号">{{ printer.serialNumberMasked }}</ElDescriptionsItem>
      <ElDescriptionsItem label="设备 ID">{{ printer.id }}</ElDescriptionsItem>
      <ElDescriptionsItem label="当前打印机">
        <ElTag :type="printer.isCurrent ? 'success' : 'info'">
          {{ printer.isCurrent ? '是' : '否' }}
        </ElTag>
      </ElDescriptionsItem>
      <ElDescriptionsItem label="绑定状态">{{ printer.status }}</ElDescriptionsItem>
      <ElDescriptionsItem label="在线状态">{{ printer.onlineStatus }}</ElDescriptionsItem>
    </ElDescriptions>
  </ElDialog>
</template>
