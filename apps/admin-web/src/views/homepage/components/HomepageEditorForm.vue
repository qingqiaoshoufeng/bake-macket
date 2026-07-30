<script setup lang="ts">
import type {
  AdminCategoryView,
  AdminProductSummaryView,
  HomepageDraftConfig,
  HomepageGridLayout,
} from '@bake-mall/contracts';
import { ElMessageBox } from 'element-plus';

import { resizeShortcutItems } from '../config/defaults.js';
import CustomerServiceEditor from './CustomerServiceEditor.vue';
import HeroCarouselEditor from './HeroCarouselEditor.vue';
import ImageBlocksEditor from './ImageBlocksEditor.vue';
import ShortcutGridEditor from './ShortcutGridEditor.vue';

const props = defineProps<{
  readonly draft: HomepageDraftConfig;
  readonly categories: readonly AdminCategoryView[];
  readonly products: readonly AdminProductSummaryView[];
}>();

const emit = defineEmits<{
  'update:draft': [value: HomepageDraftConfig];
}>();

function updateDraft(patch: Partial<HomepageDraftConfig>): void {
  emit('update:draft', { ...props.draft, ...patch });
}

async function changeShortcutLayout(layout: HomepageGridLayout): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `切换为 ${layout} 宫格会移除末尾多余入口，是否继续？`,
      '确认缩减宫格',
      { type: 'warning', confirmButtonText: '继续切换', cancelButtonText: '取消' },
    );
    updateDraft({
      shortcutGrid: {
        ...props.draft.shortcutGrid,
        layout,
        items: resizeShortcutItems(props.draft.shortcutGrid.items, layout),
      },
    });
  } catch {
    // 用户取消时保留当前宫格草稿。
  }
}
</script>

<template>
  <form class="homepage-editor-form" @submit.prevent>
    <HeroCarouselEditor
      :section="draft.hero"
      :categories="categories"
      :products="products"
      @update:section="updateDraft({ hero: $event })"
    />
    <CustomerServiceEditor
      :section="draft.customerService"
      @update:section="updateDraft({ customerService: $event })"
    />
    <ShortcutGridEditor
      :section="draft.shortcutGrid"
      :categories="categories"
      :products="products"
      @update:section="updateDraft({ shortcutGrid: $event })"
      @request-layout-change="changeShortcutLayout"
    />
    <ImageBlocksEditor
      :blocks="draft.imageBlocks"
      :categories="categories"
      :products="products"
      @update:blocks="updateDraft({ imageBlocks: $event })"
    />
  </form>
</template>

<style scoped>
.homepage-editor-form {
  display: grid;
  gap: 18px;
}

.homepage-editor-form :deep(.homepage-editor-section) {
  padding: 22px;
  scroll-margin-top: calc(var(--admin-topbar-height) + 20px);
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-card);
}

.homepage-editor-form :deep(.homepage-editor-section__header),
.homepage-editor-form :deep(.homepage-editor-card > header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.homepage-editor-form :deep(.homepage-editor-section__header) {
  margin-bottom: 18px;
}

.homepage-editor-form :deep(.homepage-editor-section__header span) {
  color: var(--admin-mint);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.homepage-editor-form :deep(.homepage-editor-section__header h2) {
  margin: 5px 0 0;
  color: var(--admin-text);
  font-size: 18px;
}

.homepage-editor-form :deep(.homepage-editor-list) {
  display: grid;
  gap: 14px;
  margin-bottom: 14px;
}

.homepage-editor-form :deep(.homepage-editor-card) {
  display: grid;
  gap: 14px;
  padding: 16px;
  scroll-margin-top: calc(var(--admin-topbar-height) + 20px);
  border: 1px solid var(--admin-border);
  border-radius: 14px;
  background: var(--admin-surface-soft);
}

.homepage-editor-form :deep(.homepage-editor-card__actions) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.homepage-editor-form :deep(.homepage-editor-card__actions .el-button + .el-button) {
  margin-left: 0;
}

.homepage-editor-form :deep(.homepage-editor-grid) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

.homepage-editor-form :deep(.homepage-editor-empty) {
  margin: 0 0 14px;
  padding: 16px;
  border: 1px dashed var(--admin-border);
  border-radius: 12px;
  color: var(--admin-muted);
  font-size: 13px;
  text-align: center;
}

.homepage-editor-form :deep(.el-select) {
  width: 100%;
}

@media (max-width: 720px) {
  .homepage-editor-form :deep(.homepage-editor-grid) {
    grid-template-columns: 1fr;
  }
}
</style>
