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
      class="product-images-editor__row"
    >
      <CosImageUploader
        scope="products"
        :model-value="image"
        @update:model-value="updateImage(image.localId, $event)"
        @uploading-change="setUploading(image.localId, $event)"
      />
      <button
        type="button"
        :data-testid="`remove-image-${index}`"
        @click="removeImage(image.localId)"
      >
        移除轮播图
      </button>
    </article>

    <section class="product-images-editor__new">
      <span>添加轮播图</span>
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

.product-images-editor__row,
.product-images-editor__new {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #ece6f7;
  border-radius: 12px;
}
</style>
