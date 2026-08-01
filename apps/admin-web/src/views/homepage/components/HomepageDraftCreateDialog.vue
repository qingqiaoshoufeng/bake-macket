<script setup lang="ts">
import { ElButton, ElDialog, ElInput } from 'element-plus';
import { ref, watch } from 'vue';

import type { HomepageDraftCreateForm } from '../type/form.js';

const props = defineProps<{
  readonly visible: boolean;
  readonly activeDraftId: string | null;
  readonly submitting: boolean;
}>();

const emit = defineEmits<{
  submit: [form: HomepageDraftCreateForm];
  cancel: [];
}>();

const name = ref('');
const mode = ref<HomepageDraftCreateForm['mode']>('COPY');
const validationError = ref<string | null>(null);

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    name.value = '';
    mode.value = props.activeDraftId ? 'COPY' : 'BLANK';
    validationError.value = null;
  },
  { immediate: true },
);

function selectMode(nextMode: HomepageDraftCreateForm['mode']): void {
  if (nextMode === 'COPY' && !props.activeDraftId) return;
  mode.value = nextMode;
}

function submit(): void {
  const trimmedName = name.value.trim();
  if (trimmedName.length === 0) {
    validationError.value = '请输入草稿名称';
    return;
  }
  if (trimmedName.length > 120) {
    validationError.value = '草稿名称不能超过 120 个字符';
    return;
  }
  validationError.value = null;
  emit('submit', { name: trimmedName, mode: mode.value });
}
</script>

<template>
  <ElDialog
    :model-value="visible"
    title="新建首页草稿"
    width="460px"
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
    :teleported="false"
    @close="emit('cancel')"
  >
    <div class="homepage-draft-create-dialog">
      <label class="homepage-draft-create-dialog__field" data-field="name">
        <span>草稿名称</span>
        <ElInput
          v-model="name"
          maxlength="120"
          show-word-limit
          placeholder="例如：中秋节首页"
          @keyup.enter="submit"
        />
        <small v-if="validationError" role="alert">
          {{ validationError }}
        </small>
      </label>

      <div class="homepage-draft-create-dialog__modes">
        <button
          type="button"
          data-mode="COPY"
          :class="{ 'is-active': mode === 'COPY' }"
          :disabled="!activeDraftId"
          @click="selectMode('COPY')"
        >
          <strong>复制当前草稿</strong>
          <span>
            {{
              activeDraftId
                ? '继承当前页面内容继续调整'
                : '当前没有可复制的草稿'
            }}
          </span>
        </button>
        <button
          type="button"
          data-mode="BLANK"
          :class="{ 'is-active': mode === 'BLANK' }"
          @click="selectMode('BLANK')"
        >
          <strong>创建空白草稿</strong>
          <span>从默认首页结构开始配置</span>
        </button>
      </div>
    </div>

    <template #footer>
      <ElButton
        data-action="cancel"
        :disabled="submitting"
        @click="emit('cancel')"
      >
        取消
      </ElButton>
      <ElButton
        type="primary"
        data-action="submit"
        :loading="submitting"
        @click="submit"
      >
        创建草稿
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.homepage-draft-create-dialog,
.homepage-draft-create-dialog__field {
  display: grid;
  gap: 10px;
}

.homepage-draft-create-dialog__field > span {
  font-weight: 700;
}

.homepage-draft-create-dialog__field small {
  color: var(--admin-danger);
}

.homepage-draft-create-dialog__modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.homepage-draft-create-dialog__modes button {
  display: grid;
  gap: 5px;
  padding: 13px;
  border: 1px solid var(--admin-border);
  border-radius: 13px;
  background: white;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.homepage-draft-create-dialog__modes button.is-active {
  border-color: var(--admin-mint);
  background: color-mix(in srgb, var(--admin-mint) 12%, white);
}

.homepage-draft-create-dialog__modes button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.homepage-draft-create-dialog__modes span {
  color: var(--admin-muted);
  font-size: 12px;
  line-height: 1.5;
}
</style>
