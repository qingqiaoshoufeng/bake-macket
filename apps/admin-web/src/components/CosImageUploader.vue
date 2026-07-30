<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElButton, ElMessage } from 'element-plus';

import type { MediaAsset } from '@bake-mall/contracts';

import {
  MAX_UPLOAD_BYTES,
  performUpload,
  type PresignScope,
} from '../api/upload.js';

const props = defineProps<{
  scope: PresignScope;
  modelValue: MediaAsset | null;
  label?: string;
  previewAspectRatio?: string;
  sceneHint?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: MediaAsset | null];
  'uploading-change': [value: boolean];
}>();

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const previewUrl = computed(() => props.modelValue?.publicUrl ?? '');
const objectKey = computed(() => props.modelValue?.objectKey ?? null);
const uploading = ref(false);
const dragging = ref(false);
const lastError = ref<string | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

function validate(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    return '仅支持 JPEG / PNG / WebP 格式';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return '文件大小不能超过 5 MiB';
  }
  return null;
}

async function uploadFile(file: File, input?: HTMLInputElement): Promise<void> {
  const error = validate(file);
  if (error) {
    lastError.value = error;
    ElMessage.error(error);
    if (input) input.value = '';
    return;
  }
  lastError.value = null;
  uploading.value = true;
  emit('uploading-change', true);
  try {
    const result = await performUpload(file, props.scope);
    emit('update:modelValue', {
      objectKey: result.objectKey,
      publicUrl: result.publicUrl,
    });
  } catch (uploadError) {
    const message =
      uploadError instanceof Error
        ? uploadError.message
        : '上传失败,请稍后重试';
    lastError.value = message;
    ElMessage.error(message);
  } finally {
    uploading.value = false;
    emit('uploading-change', false);
    if (input) input.value = '';
  }
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void uploadFile(file, input);
}

function openFilePicker(): void {
  fileInputRef.value?.click();
}

function onDragOver(): void {
  if (!uploading.value) dragging.value = true;
}

function onDragLeave(): void {
  dragging.value = false;
}

function onDrop(event: DragEvent): void {
  dragging.value = false;
  const file = event.dataTransfer?.files[0];
  if (file && !uploading.value) void uploadFile(file);
}

function clearImage(): void {
  emit('update:modelValue', null);
}
</script>

<template>
  <div class="cos-uploader">
    <button
      type="button"
      class="cos-uploader__drop-area"
      :class="{ 'is-dragging': dragging, 'has-image': previewUrl }"
      :style="previewAspectRatio ? { aspectRatio: previewAspectRatio } : undefined"
      :disabled="uploading"
      data-testid="cos-upload-drop-area"
      @click="openFilePicker"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt="图片预览"
        class="cos-uploader__image"
      />
      <span v-else class="cos-uploader__placeholder">
        <strong>拖放图片到这里</strong>
        <small>或点击选择本地文件</small>
      </span>
    </button>

    <div class="cos-uploader__content">
      <input
        ref="fileInputRef"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        data-testid="cos-upload-input"
        class="cos-uploader__file-input"
        @change="onFileChange"
      />
      <div class="cos-uploader__actions">
        <ElButton
          type="primary"
          plain
          :loading="uploading"
          @click="openFilePicker"
        >
          {{
            uploading
              ? '上传中…'
              : (label ?? (modelValue ? '更换图片' : '选择图片'))
          }}
        </ElButton>
        <ElButton
          v-if="modelValue"
          data-testid="clear-image"
          type="danger"
          plain
          @click="clearImage"
        >
          清空图片
        </ElButton>
      </div>
      <span
        v-if="objectKey"
        class="cos-uploader__object-key"
        :title="objectKey"
      >
        已上传 · {{ objectKey }}
      </span>
      <p v-if="lastError" class="cos-uploader__error" role="alert">
        {{ lastError }}
      </p>
      <p class="cos-uploader__hint">
        {{ sceneHint ? `${sceneHint}；` : '' }}支持 JPEG / PNG / WebP，单文件最大 5 MiB。
      </p>
    </div>
  </div>
</template>

<style scoped>
.cos-uploader {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.cos-uploader__drop-area {
  position: relative;
  display: grid;
  width: 132px;
  min-height: 132px;
  padding: 0;
  overflow: hidden;
  place-items: center;
  border: 1px dashed #c9bde0;
  border-radius: 14px;
  background: var(--admin-surface-soft);
  color: var(--admin-muted);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.cos-uploader__drop-area:hover,
.cos-uploader__drop-area:focus-visible,
.cos-uploader__drop-area.is-dragging {
  border-color: var(--admin-primary);
  background: var(--admin-primary-soft);
  box-shadow: 0 0 0 4px rgb(121 101 184 / 10%);
  outline: none;
}

.cos-uploader__drop-area.has-image {
  border-style: solid;
  background: var(--admin-surface);
}

.cos-uploader__drop-area:disabled {
  cursor: wait;
  opacity: 0.72;
}

.cos-uploader__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cos-uploader__placeholder {
  display: grid;
  gap: 5px;
  padding: 14px;
  text-align: center;
}

.cos-uploader__placeholder strong {
  color: var(--admin-text);
  font-size: 12px;
}

.cos-uploader__placeholder small {
  font-size: 11px;
  line-height: 1.5;
}

.cos-uploader__content {
  display: grid;
  min-width: 0;
  gap: 8px;
}

.cos-uploader__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cos-uploader__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.cos-uploader__file-input {
  display: none;
}

.cos-uploader__object-key {
  max-width: 100%;
  overflow: hidden;
  color: var(--admin-mint);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cos-uploader__error,
.cos-uploader__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.cos-uploader__error {
  color: var(--admin-danger);
}

.cos-uploader__hint {
  color: var(--admin-muted);
}

@media (max-width: 520px) {
  .cos-uploader {
    grid-template-columns: 1fr;
  }
}
</style>
