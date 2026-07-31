<script setup lang="ts">
import type { HomepageDraftConfig } from '@bake-mall/contracts';
import { ElFormItem, ElInput, ElSwitch } from 'element-plus';

import CosImageUploader from '../../../components/CosImageUploader.vue';

const props = defineProps<{
  readonly section: HomepageDraftConfig['customerService'];
}>();

const emit = defineEmits<{
  'update:section': [value: HomepageDraftConfig['customerService']];
}>();

function updateSection(
  patch: Partial<HomepageDraftConfig['customerService']>,
): void {
  emit('update:section', { ...props.section, ...patch });
}
</script>

<template>
  <section :id="section.id" class="homepage-editor-section">
    <header class="homepage-editor-section__header">
      <div>
        <span>02 · 客服信息</span>
        <h2>把门店服务放在顾客手边</h2>
      </div>
      <ElSwitch
        :model-value="section.enabled"
        active-text="显示"
        @update:model-value="updateSection({ enabled: Boolean($event) })"
      />
    </header>

    <div class="homepage-editor-grid">
      <ElFormItem label="区块标题">
        <ElInput
          :model-value="section.title"
          maxlength="80"
          @update:model-value="updateSection({ title: String($event) })"
        />
      </ElFormItem>
      <ElFormItem label="客服电话" required>
        <ElInput
          :model-value="section.phone"
          maxlength="40"
          placeholder="例如 13800000000"
          @update:model-value="updateSection({ phone: String($event) })"
        />
      </ElFormItem>
      <ElFormItem label="服务时间" required>
        <ElInput
          :model-value="section.serviceHours"
          maxlength="80"
          placeholder="例如 每日 09:00–20:00"
          @update:model-value="updateSection({ serviceHours: String($event) })"
        />
      </ElFormItem>
    </div>
    <ElFormItem label="说明">
      <ElInput
        type="textarea"
        :rows="3"
        :model-value="section.description"
        maxlength="240"
        @update:model-value="updateSection({ description: String($event) })"
      />
    </ElFormItem>
    <ElFormItem label="微信二维码" required>
      <CosImageUploader
        compact
        scope="homepage"
        :model-value="section.wechatQrCode"
        preview-aspect-ratio="1 / 1"
        scene-hint="请上传正方形二维码"
        @update:model-value="updateSection({ wechatQrCode: $event })"
      />
    </ElFormItem>
  </section>
</template>
