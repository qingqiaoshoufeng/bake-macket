<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElButton, ElMessage } from 'element-plus';

import type { MediaAsset } from '@bake-mall/contracts';

import {
  MAX_UPLOAD_BYTES,
  performUpload,
  type PresignScope,
} from '../api/upload.js';

/**
 * CosImageUploader (Task 12): drives the two-step image upload flow.
 *
 * - Accepts JPEG / PNG / WebP up to 5 MiB. Validation runs locally so the
 *   merchant sees an immediate error before any HTTP round-trip; on
 *   failure the surrounding form data is preserved (no reset).
 * - Calls `POST /api/v1/upload/presign` then performs a multipart POST to
 *   the returned S3-compatible URL.
 * - Emits the complete `MediaAsset` through `update:modelValue` and reports
 *   upload activity so parent forms can prevent saving in-flight data.
 *
 * The component never throws on user-cancellation. Real network errors
 * surface through `ElMessage.error` so the merchant gets feedback
 * consistent with the rest of the admin SPA.
 */

const props = defineProps<{
  scope: PresignScope;
  modelValue: MediaAsset | null;
  label?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: MediaAsset | null];
  'uploading-change': [value: boolean];
}>();

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const previewUrl = computed(() => props.modelValue?.publicUrl ?? '');
const objectKey = computed(() => props.modelValue?.objectKey ?? null);
const uploading = ref(false);
const lastError = ref<string | null>(null);

function validate(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    return '仅支持 JPEG / PNG / WebP 格式';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return '文件大小不能超过 5 MiB';
  }
  return null;
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const error = validate(file);
  if (error) {
    lastError.value = error;
    ElMessage.error(error);
    input.value = '';
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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '上传失败,请稍后重试';
    lastError.value = message;
    ElMessage.error(message);
  } finally {
    uploading.value = false;
    emit('uploading-change', false);
    input.value = '';
  }
}

function clearImage(): void {
  emit('update:modelValue', null);
}
</script>

<template>
  <div class="cos-uploader">
    <div class="cos-uploader__preview">
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt="图片预览"
        class="cos-uploader__image"
      />
      <div v-else class="cos-uploader__placeholder">暂无图片</div>
    </div>

    <div class="cos-uploader__form">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        :data-testid="`cos-upload-input`"
        class="cos-uploader__file-input"
        @change="onFileChange"
      />
      <ElButton
        type="primary"
        plain
        :loading="uploading"
        @click="
          ($event) => {
            const input = (
              $event.currentTarget as HTMLElement
            ).parentElement?.querySelector(
              'input[type=file]',
            ) as HTMLInputElement | null;
            input?.click();
          }
        "
      >
        {{ uploading ? '上传中…' : (label ?? '选择文件并上传') }}
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
      <span v-if="objectKey" class="cos-uploader__object-key">
        objectKey: {{ objectKey }}
      </span>
      <p v-if="lastError" class="cos-uploader__error">
        {{ lastError }}
      </p>
      <p class="cos-uploader__hint">
        支持 JPEG / PNG / WebP,单文件最大 5 MiB。
      </p>
    </div>
  </div>
</template>

<style scoped>
.cos-uploader {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 16px;
  align-items: start;
}

.cos-uploader__preview {
  width: 120px;
  height: 120px;
  border: 1px dashed #d4c7ec;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}

.cos-uploader__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cos-uploader__placeholder {
  color: #b6aecf;
  font-size: 12px;
}

.cos-uploader__form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cos-uploader__file-input {
  display: none;
}

.cos-uploader__error {
  margin: 0;
  color: #d14545;
  font-size: 12px;
}

.cos-uploader__hint {
  margin: 0;
  color: #8a83a3;
  font-size: 12px;
}
</style>
