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
    <section class="product-form__section" data-form-section="basic">
      <header class="product-form__section-head">
        <span class="product-form__step">01</span>
        <div>
          <h2>基础信息</h2>
          <p>设置顾客在商品列表中最先看到的名称、简介与分类。</p>
        </div>
      </header>
      <div class="product-form__fields product-form__fields--basic">
        <ElFormItem label="商品名称">
          <ElInput
            :model-value="form.name"
            data-testid="product-name"
            placeholder="请输入商品名称"
            @update:model-value="updateText('name', $event)"
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
        <ElFormItem class="product-form__field--wide" label="商品简介">
          <ElInput
            :model-value="form.summary"
            data-testid="product-summary"
            type="textarea"
            :rows="3"
            placeholder="用一两句话介绍商品特色"
            @update:model-value="updateText('summary', $event)"
          />
        </ElFormItem>
      </div>
    </section>

    <section class="product-form__section" data-form-section="media">
      <header class="product-form__section-head">
        <span class="product-form__step">02</span>
        <div>
          <h2>商品媒体</h2>
          <p>封面用于列表展示，轮播图用于呈现更多商品细节。</p>
        </div>
      </header>
      <div class="product-form__media-grid">
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
      </div>
    </section>

    <section class="product-form__section" data-form-section="detail">
      <header class="product-form__section-head">
        <span class="product-form__step">03</span>
        <div>
          <h2>图文详情</h2>
          <p>编辑顾客进入详情页后阅读的商品故事、原料与说明。</p>
        </div>
      </header>
      <ElFormItem label="商品详情">
        <RichTextEditor
          :model-value="form.detailHtml"
          @update:model-value="updateText('detailHtml', $event)"
        />
      </ElFormItem>
    </section>

    <section class="product-form__section" data-form-section="skus">
      <header class="product-form__section-head">
        <span class="product-form__step">04</span>
        <div>
          <h2>SKU 与库存</h2>
          <p>维护规格、售价、库存和独立图片；宽表格可横向滚动。</p>
        </div>
      </header>
      <ElFormItem label="SKU">
        <SkuTableEditor
          :model-value="form.skus"
          @update:model-value="updateSkus"
          @uploading-change="updateUploading('skus', $event)"
        />
      </ElFormItem>
    </section>

    <section class="product-form__section" data-form-section="publish">
      <header class="product-form__section-head">
        <span class="product-form__step">05</span>
        <div>
          <h2>发布设置</h2>
          <p>确认排序和上下架状态，再保存本次修改。</p>
        </div>
      </header>
      <div class="product-form__fields product-form__fields--publish">
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
      </div>
    </section>

    <div class="product-form__sticky-actions" data-sticky-offset="content-edge">
      <div class="product-form__action-copy" aria-live="polite">
        <strong>{{ effectiveUploading ? '图片上传中' : '内容已就绪' }}</strong>
        <span>
          {{
            effectiveUploading
              ? '上传完成后即可保存'
              : '保存后将更新服务端详情预览'
          }}
        </span>
      </div>
      <ElButton
        native-type="submit"
        type="primary"
        size="large"
        :loading="saving"
        :disabled="saving || effectiveUploading"
      >
        保存商品
      </ElButton>
    </div>
  </ElForm>
</template>

<style scoped>
.product-form {
  display: grid;
  min-width: 0;
  max-width: 100%;
  gap: 18px;
  padding-bottom: 92px;
}

.product-form :deep(.el-form-item),
.product-form :deep(.el-form-item__content) {
  min-width: 0;
}

.product-form__section {
  min-width: 0;
  padding: 22px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-card);
}

.product-form__section-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--admin-border);
}

.product-form__step {
  display: grid;
  flex: none;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 11px;
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.product-form__section-head h2,
.product-form__section-head p {
  margin: 0;
}

.product-form__section-head h2 {
  color: var(--admin-text);
  font-size: 17px;
  line-height: 1.4;
}

.product-form__section-head p {
  margin-top: 3px;
  color: var(--admin-muted);
  font-size: 13px;
  line-height: 1.6;
}

.product-form__fields {
  display: grid;
  gap: 0 18px;
}

.product-form__fields--basic {
  grid-template-columns: minmax(0, 1fr) minmax(220px, 0.45fr);
}

.product-form__fields--publish {
  grid-template-columns: minmax(180px, 0.35fr) minmax(220px, 1fr);
}

.product-form__field--wide {
  grid-column: 1 / -1;
}

.product-form__media-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.75fr) minmax(360px, 1.25fr);
  gap: 24px;
}

.product-form__sticky-actions {
  position: sticky;
  z-index: 10;
  bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 72px;
  padding: 12px 14px 12px 18px;
  border: 1px solid rgb(121 101 184 / 24%);
  border-radius: var(--admin-radius-card);
  background: rgb(255 255 255 / 94%);
  box-shadow: 0 16px 42px rgb(73 57 105 / 18%);
  backdrop-filter: blur(14px);
}

.product-form__action-copy {
  display: grid;
  gap: 2px;
}

.product-form__action-copy strong {
  color: var(--admin-text);
  font-size: 13px;
}

.product-form__action-copy span {
  color: var(--admin-muted);
  font-size: 12px;
}

.product-form__sticky-actions :deep(.el-button) {
  min-width: 132px;
}

@media (max-width: 980px) {
  .product-form__media-grid,
  .product-form__fields--basic {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .product-form {
    padding-bottom: 108px;
  }

  .product-form__section {
    padding: 18px;
  }

  .product-form__fields--publish {
    grid-template-columns: 1fr;
  }

  .product-form__sticky-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
