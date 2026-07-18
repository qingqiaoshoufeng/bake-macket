<script setup lang="ts">
import {
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
  ElSwitch,
} from 'element-plus';

import type { AdminCategoryView, MediaAsset } from '@bake-mall/contracts';
import { computed, ref } from 'vue';

import CosImageUploader from '../../../components/CosImageUploader.vue';
import RichTextEditor from '../../../components/RichTextEditor.vue';
import type {
  ProductFormShape,
  ProductImageFormRow,
  SkuFormRow,
} from '../type/form.js';
import ProductImagesEditor from './ProductImagesEditor.vue';
import SkuTableEditor from './SkuTableEditor.vue';

const props = defineProps<{
  form: ProductFormShape;
  categories: readonly AdminCategoryView[];
  saving: boolean;
  uploading: boolean;
}>();

const emit = defineEmits<{
  'update:form': [value: ProductFormShape];
  'update:uploading': [value: boolean];
  submit: [];
}>();

const localUploadingBySection = ref<Readonly<Record<string, boolean>>>({});
const localUploading = computed(() =>
  Object.values(localUploadingBySection.value).some(Boolean),
);
const effectiveUploading = computed(
  () => props.uploading || localUploading.value,
);

function updateUploading(section: string, uploading: boolean): void {
  localUploadingBySection.value = {
    ...localUploadingBySection.value,
    [section]: uploading,
  };
  emit('update:uploading', localUploading.value);
}

function updateForm(update: Partial<ProductFormShape>): void {
  emit('update:form', { ...props.form, ...update });
}

function updateText(
  field: 'name' | 'summary' | 'categoryId' | 'detailHtml',
  value: string,
): void {
  updateForm({ [field]: value });
}

function updateSortOrder(value: number | undefined): void {
  updateForm({ sortOrder: value ?? 0 });
}

function updateCoverImage(coverImage: MediaAsset | null): void {
  updateForm({ coverImage });
}

function updateImages(images: readonly ProductImageFormRow[]): void {
  updateForm({ images });
}

function updateSkus(skus: readonly SkuFormRow[]): void {
  updateForm({ skus });
}

function updateIsActive(isActive: boolean | string | number): void {
  updateForm({ isActive: isActive === true });
}

function submit(): void {
  emit('submit');
}
</script>

<template>
  <ElForm class="product-form" label-position="top" @submit.prevent="submit">
    <ElFormItem label="商品名称">
      <ElInput
        :model-value="form.name"
        data-testid="product-name"
        placeholder="请输入商品名称"
        @update:model-value="updateText('name', $event)"
      />
    </ElFormItem>

    <ElFormItem label="商品简介">
      <ElInput
        :model-value="form.summary"
        data-testid="product-summary"
        placeholder="请输入商品简介"
        @update:model-value="updateText('summary', $event)"
      />
    </ElFormItem>

    <ElFormItem label="商品分类">
      <ElSelect
        :model-value="form.categoryId"
        data-testid="product-category"
        placeholder="请选择商品分类"
        @update:model-value="updateText('categoryId', $event)"
      >
        <ElOption
          v-for="category in categories"
          :key="category.id"
          :label="category.name"
          :value="category.id"
        />
      </ElSelect>
    </ElFormItem>

    <ElFormItem label="封面图">
      <CosImageUploader
        scope="products"
        :model-value="form.coverImage"
        @update:model-value="updateCoverImage"
        @uploading-change="updateUploading('cover', $event)"
      />
    </ElFormItem>

    <ElFormItem label="轮播图">
      <ProductImagesEditor
        :model-value="form.images"
        @update:model-value="updateImages"
        @uploading-change="updateUploading('images', $event)"
      />
    </ElFormItem>

    <ElFormItem label="商品详情">
      <RichTextEditor
        :model-value="form.detailHtml"
        @update:model-value="updateText('detailHtml', $event)"
      />
    </ElFormItem>

    <ElFormItem label="SKU">
      <SkuTableEditor
        :model-value="form.skus"
        @update:model-value="updateSkus"
        @uploading-change="updateUploading('skus', $event)"
      />
    </ElFormItem>

    <ElFormItem label="排序">
      <ElInput
        :model-value="String(form.sortOrder)"
        data-testid="product-sort-order"
        inputmode="numeric"
        @update:model-value="updateSortOrder(Number($event))"
      />
    </ElFormItem>

    <ElFormItem label="商品状态">
      <ElSwitch
        :model-value="form.isActive"
        data-testid="product-active"
        active-text="上架"
        inactive-text="下架"
        @update:model-value="updateIsActive($event)"
      />
    </ElFormItem>

    <ElButton
      native-type="submit"
      type="primary"
      :loading="saving"
      :disabled="saving || effectiveUploading"
    >
      保存商品
    </ElButton>
  </ElForm>
</template>

<style scoped>
.product-form {
  padding: 20px;
  border: 1px solid #ece6f7;
  border-radius: 16px;
  background: #fff;
}
</style>
