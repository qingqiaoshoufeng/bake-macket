<script setup lang="ts">
import { computed, ref } from 'vue';

import type { MediaAsset } from '@bake-mall/contracts';

import CosImageUploader from '../../../components/CosImageUploader.vue';
import type { ProductImageFormRow } from '../type/form.js';

const props = defineProps<{
  modelValue: readonly ProductImageFormRow[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: readonly ProductImageFormRow[]];
  'uploading-change': [value: boolean];
}>();

const localIdCounter = { value: 0 };

function nextLocalId(): string {
  localIdCounter.value += 1;
  return `product-image-${localIdCounter.value}`;
}

const pendingLocalId = ref(nextLocalId());
const uploadingByLocalId = ref<Readonly<Record<string, boolean>>>({});
const uploading = computed(() =>
  Object.values(uploadingByLocalId.value).some(Boolean),
);

function emitUploading(): void {
  emit('uploading-change', uploading.value);
}

function setUploading(localId: string, value: boolean): void {
  uploadingByLocalId.value = {
    ...uploadingByLocalId.value,
    [localId]: value,
  };
  emitUploading();
}

function removeUploading(localId: string): void {
  const { [localId]: removed, ...remaining } = uploadingByLocalId.value;
  void removed;
  uploadingByLocalId.value = remaining;
  emitUploading();
}

function addImage(asset: MediaAsset | null): void {
  if (!asset) return;
  const localId = pendingLocalId.value;
  emit('update:modelValue', [
    ...props.modelValue,
    {
      localId,
      ...asset,
      sortOrder: props.modelValue.length,
    },
  ]);
  removeUploading(localId);
  pendingLocalId.value = nextLocalId();
}

function updateImage(localId: string, asset: MediaAsset | null): void {
  if (!asset) {
    removeImage(localId);
    return;
  }
  emit(
    'update:modelValue',
    props.modelValue.map((image) =>
      image.localId === localId ? { ...image, ...asset } : image,
    ),
  );
}

function removeImage(localId: string): void {
  emit(
    'update:modelValue',
    props.modelValue
      .filter((image) => image.localId !== localId)
      .map((image, sortOrder) => ({ ...image, sortOrder })),
  );
  removeUploading(localId);
}
</script>

<template>
  <div class="product-images-editor">
    <article
      v-for="(image, index) in modelValue"
      :key="image.localId"
      class="product-images-editor__card"
    >
      <header class="product-images-editor__card-head">
        <div>
          <span class="product-images-editor__order">{{ index + 1 }}</span>
          <strong>轮播图 {{ index + 1 }}</strong>
        </div>
        <span class="product-images-editor__sort"
          >排序 {{ image.sortOrder }}</span
        >
      </header>
      <CosImageUploader
        scope="products"
        :model-value="image"
        label="替换图片"
        @update:model-value="updateImage(image.localId, $event)"
        @uploading-change="setUploading(image.localId, $event)"
      />
      <button
        class="product-images-editor__remove"
        type="button"
        :data-testid="`remove-image-${index}`"
        @click="removeImage(image.localId)"
      >
        移除这张轮播图
      </button>
    </article>

    <section class="product-images-editor__new">
      <header>
        <strong>添加轮播图</strong>
        <span>上传后自动追加到第 {{ modelValue.length + 1 }} 位</span>
      </header>
      <CosImageUploader
        :key="pendingLocalId"
        scope="products"
        :model-value="null"
        @update:model-value="addImage"
        @uploading-change="setUploading(pendingLocalId, $event)"
      />
    </section>
  </div>
</template>

<style scoped>
.product-images-editor {
  display: grid;
  gap: 12px;
}

.product-images-editor__card,
.product-images-editor__new {
  display: grid;
  min-width: 0;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--admin-border);
  border-radius: 14px;
  background: var(--admin-surface-soft);
}

.product-images-editor__card-head,
.product-images-editor__card-head > div,
.product-images-editor__new header {
  display: flex;
  align-items: center;
}

.product-images-editor__card-head {
  justify-content: space-between;
  gap: 12px;
}

.product-images-editor__card-head > div {
  gap: 8px;
}

.product-images-editor__order {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 8px;
  background: var(--admin-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
}

.product-images-editor__sort {
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--admin-surface);
  color: var(--admin-muted);
  font-size: 11px;
}

.product-images-editor__remove {
  justify-self: start;
  padding: 7px 10px;
  border: 1px solid rgb(180 63 102 / 20%);
  border-radius: 8px;
  background: #fff;
  color: var(--admin-danger);
  cursor: pointer;
}

.product-images-editor__new {
  border-style: dashed;
  background: var(--admin-surface);
}

.product-images-editor__new header {
  align-items: flex-start;
  flex-direction: column;
  gap: 3px;
}

.product-images-editor__new header span {
  color: var(--admin-muted);
  font-size: 11px;
}
</style>
