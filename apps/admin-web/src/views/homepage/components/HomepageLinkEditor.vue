<script setup lang="ts">
import {
  HomepageLinkType,
  type AdminCategoryView,
  type AdminProductSummaryView,
  type HomepageInternalPage,
  type HomepageLink,
} from '@bake-mall/contracts';
import { ElFormItem, ElOption, ElSelect } from 'element-plus';

import {
  INTERNAL_PAGE_OPTIONS,
  LINK_TYPE_OPTIONS,
} from '../config/options.js';

const props = defineProps<{
  readonly modelValue: HomepageLink;
  readonly categories: readonly AdminCategoryView[];
  readonly products: readonly AdminProductSummaryView[];
  readonly label?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: HomepageLink];
}>();

function updateType(type: HomepageLinkType): void {
  if (type === HomepageLinkType.PRODUCT) {
    emit('update:modelValue', { type, targetId: props.products[0]?.id ?? '' });
    return;
  }
  if (type === HomepageLinkType.CATEGORY) {
    emit('update:modelValue', { type, targetId: props.categories[0]?.id ?? '' });
    return;
  }
  if (type === HomepageLinkType.PAGE) {
    emit('update:modelValue', { type, page: INTERNAL_PAGE_OPTIONS[0].value });
    return;
  }
  emit('update:modelValue', { type: HomepageLinkType.NONE });
}

function updateTargetId(targetId: string): void {
  if (
    props.modelValue.type === HomepageLinkType.PRODUCT ||
    props.modelValue.type === HomepageLinkType.CATEGORY
  ) {
    emit('update:modelValue', { type: props.modelValue.type, targetId });
  }
}

function updatePage(page: HomepageInternalPage): void {
  emit('update:modelValue', { type: HomepageLinkType.PAGE, page });
}
</script>

<template>
  <div class="homepage-link-editor">
    <ElFormItem :label="label ?? '点击跳转'">
      <ElSelect
        :model-value="modelValue.type"
        @update:model-value="updateType($event as HomepageLinkType)"
      >
        <ElOption
          v-for="option in LINK_TYPE_OPTIONS"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </ElSelect>
    </ElFormItem>

    <ElFormItem v-if="modelValue.type === HomepageLinkType.PRODUCT" label="商品">
      <ElSelect
        filterable
        :model-value="modelValue.targetId"
        placeholder="选择已启用商品"
        @update:model-value="updateTargetId(String($event))"
      >
        <ElOption
          v-for="product in products"
          :key="product.id"
          :label="product.name"
          :value="product.id"
        />
      </ElSelect>
    </ElFormItem>

    <ElFormItem v-else-if="modelValue.type === HomepageLinkType.CATEGORY" label="分类">
      <ElSelect
        filterable
        :model-value="modelValue.targetId"
        placeholder="选择已启用分类"
        @update:model-value="updateTargetId(String($event))"
      >
        <ElOption
          v-for="category in categories"
          :key="category.id"
          :label="category.name"
          :value="category.id"
        />
      </ElSelect>
    </ElFormItem>

    <ElFormItem v-else-if="modelValue.type === HomepageLinkType.PAGE" label="商城页面">
      <ElSelect
        :model-value="modelValue.page"
        @update:model-value="updatePage($event as HomepageInternalPage)"
      >
        <ElOption
          v-for="option in INTERNAL_PAGE_OPTIONS"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </ElSelect>
    </ElFormItem>
  </div>
</template>

<style scoped>
.homepage-link-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}

.homepage-link-editor :deep(.el-select) {
  width: 100%;
}

@media (max-width: 720px) {
  .homepage-link-editor {
    grid-template-columns: 1fr;
  }
}
</style>
