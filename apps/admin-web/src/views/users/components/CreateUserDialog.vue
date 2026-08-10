<script setup lang="ts">
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus';

import type { CreateUserForm } from '../type/index.js';

const props = defineProps<{
  readonly visible: boolean;
  readonly form: CreateUserForm;
  readonly submitting: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'update:phone': [phone: string];
  submit: [];
}>();
</script>

<template>
  <ElDialog
    :model-value="visible"
    title="添加用户"
    width="min(92vw, 480px)"
    :close-on-click-modal="!submitting"
    :close-on-press-escape="!submitting"
    @close="emit('close')"
  >
    <p class="create-user-dialog__hint">
      通过手机号建立待验证用户。用户后续完成微信手机号授权时将自动关联。
    </p>
    <ElForm @submit.prevent="emit('submit')">
      <ElFormItem label="手机号">
        <ElInput
          :model-value="props.form.phone"
          inputmode="numeric"
          maxlength="11"
          autocomplete="tel"
          placeholder="请输入 11 位中国大陆手机号"
          data-testid="create-user-phone"
          @update:model-value="emit('update:phone', String($event))"
        />
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton :disabled="submitting" @click="emit('close')">取消</ElButton>
      <ElButton
        type="primary"
        :loading="submitting"
        data-testid="create-user-submit"
        @click="emit('submit')"
      >
        {{ submitting ? '添加中…' : '确认添加' }}
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.create-user-dialog__hint {
  margin: -4px 0 20px;
  color: var(--admin-muted);
  font-size: 13px;
  line-height: 1.7;
}
</style>
