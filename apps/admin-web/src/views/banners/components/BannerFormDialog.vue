<script setup lang="ts">
import { computed } from 'vue';

import { BannerTargetType, type MediaAsset } from '@bake-mall/contracts';
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElSwitch,
} from 'element-plus';

import CosImageUploader from '../../../components/CosImageUploader.vue';
import type { BannerFormShape, BannerTargetOption } from '../type/form.js';

const props = defineProps<{
  visible: boolean;
  editing: boolean;
  form: BannerFormShape;
  targetOptions: readonly BannerTargetOption[];
  saving: boolean;
  uploading: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [];
  'target-type-change': [value: BannerTargetType];
  'form-change': [value: Partial<BannerFormShape>];
  'image-change': [value: MediaAsset | null];
  'uploading-change': [value: boolean];
}>();

const title = computed({
  get: () => props.form.title,
  set: (value: string) => emit('form-change', { title: value }),
});
const sortOrder = computed({
  get: () => props.form.sortOrder,
  set: (value: number | undefined) =>
    emit('form-change', { sortOrder: value ?? 0 }),
});
const targetId = computed({
  get: () => props.form.targetId,
  set: (value: string) => emit('form-change', { targetId: value }),
});
const isActive = computed({
  get: () => props.form.isActive,
  set: (value: boolean) => emit('form-change', { isActive: value }),
});
</script>

<template>
  <ElDialog
    :model-value="visible"
    :title="editing ? '编辑 Banner' : '新增 Banner'"
    width="min(640px, 92vw)"
    :close-on-click-modal="false"
    @close="emit('close')"
  >
    <ElForm label-position="top" class="banner-form">
      <ElFormItem label="Banner 图片" required>
        <CosImageUploader
          scope="banners"
          :model-value="props.form.image"
          label="上传横幅图片"
          @update:model-value="emit('image-change', $event)"
          @uploading-change="emit('uploading-change', $event)"
        />
      </ElFormItem>
      <div class="form-grid">
        <ElFormItem label="标题">
          <ElInput
            v-model="title"
            maxlength="128"
            show-word-limit
            placeholder="可选，用于后台识别和无障碍说明"
          />
        </ElFormItem>
        <ElFormItem label="排序">
          <ElInputNumber v-model="sortOrder" :min="0" />
        </ElFormItem>
      </div>
      <ElFormItem label="点击后跳转">
        <ElRadioGroup
          :model-value="props.form.targetType"
          @change="emit('target-type-change', $event as BannerTargetType)"
        >
          <ElRadio :value="BannerTargetType.NONE">无跳转</ElRadio>
          <ElRadio :value="BannerTargetType.PRODUCT">商品</ElRadio>
          <ElRadio :value="BannerTargetType.CATEGORY">分类</ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem
        v-if="props.form.targetType !== BannerTargetType.NONE"
        :label="
          props.form.targetType === BannerTargetType.PRODUCT
            ? '选择有效商品'
            : '选择有效分类'
        "
        required
      >
        <ElSelect
          v-model="targetId"
          filterable
          placeholder="请选择跳转目标"
          style="width: 100%"
        >
          <ElOption
            v-for="option in props.targetOptions"
            :key="option.id"
            :label="option.label"
            :value="option.id"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="展示状态">
        <ElSwitch v-model="isActive" active-text="上架" inactive-text="下架" />
      </ElFormItem>
    </ElForm>

    <template #footer>
      <ElButton :disabled="saving || uploading" @click="emit('close')">
        取消
      </ElButton>
      <ElButton
        type="primary"
        :loading="saving"
        :disabled="uploading"
        @click="emit('save')"
      >
        {{ uploading ? '图片上传中' : '保存 Banner' }}
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.banner-form {
  padding: 4px 6px 0;
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 16px;
}

@media (max-width: 560px) {
  .form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
