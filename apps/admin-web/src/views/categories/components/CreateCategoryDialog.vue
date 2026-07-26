<script setup lang="ts">
/**
 * Create-category dialog (purely presentational).
 *
 * The dialog owns no business state beyond its open / submit-pending
 * flags; the parent supplies the form shape and merges updates back via
 * `update:form` events. Sub-component props stay here per the skill.
 */

import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElSwitch,
} from 'element-plus';

import type { CategoryFormShape } from '../type/form.js';

const props = defineProps<{
  open: boolean;
  form: CategoryFormShape;
  submitting: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  'update:form': [patch: Partial<CategoryFormShape>];
  submit: [];
}>();

function setOpen(value: boolean): void {
  emit('update:open', value);
}

function onField<K extends keyof CategoryFormShape>(
  key: K,
  value: CategoryFormShape[K],
): void {
  emit('update:form', { [key]: value } as Partial<CategoryFormShape>);
}

void props;
</script>

<template>
  <ElDialog
    :model-value="open"
    title="新增分类"
    width="420px"
    class="admin-form-dialog"
    :data-testid="'category-dialog'"
    @update:model-value="setOpen"
  >
    <ElForm label-position="top" class="admin-dialog-form">
      <ElFormItem label="分类名称" required>
        <ElInput
          :model-value="form.name"
          placeholder="例如 生日蛋糕"
          :data-testid="'dialog-name'"
          @update:model-value="(v) => onField('name', String(v))"
        />
      </ElFormItem>
      <ElFormItem label="图标/图片 URL">
        <ElInput
          :model-value="form.imageUrl"
          placeholder="https://..."
          :data-testid="'dialog-image'"
          @update:model-value="(v) => onField('imageUrl', String(v))"
        />
      </ElFormItem>
      <ElFormItem label="排序">
        <ElInputNumber
          :model-value="form.sortOrder"
          :min="0"
          :data-testid="'dialog-sort'"
          @update:model-value="(v) => onField('sortOrder', Number(v ?? 0))"
        />
      </ElFormItem>
      <ElFormItem label="启用">
        <ElSwitch
          :model-value="form.isActive"
          @update:model-value="(v) => onField('isActive', Boolean(v))"
        />
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton @click="setOpen(false)">取消</ElButton>
      <ElButton
        type="primary"
        :loading="submitting"
        :data-testid="'dialog-submit'"
        @click="emit('submit')"
      >
        保存
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.admin-dialog-form {
  display: grid;
  gap: 4px;
}
</style>
