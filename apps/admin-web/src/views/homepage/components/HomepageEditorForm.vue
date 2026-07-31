<script setup lang="ts">
import type {
  AdminCategoryView,
  AdminProductSummaryView,
  HomepageDraftConfig,
  HomepageGridLayout,
} from '@bake-mall/contracts';
import { ElMessageBox } from 'element-plus';
import { computed, ref } from 'vue';

import { resizeShortcutItems } from '../config/defaults.js';
import {
  HOMEPAGE_EDITOR_TABS,
  type HomepageEditorTab,
} from '../config/editor-tabs.js';
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

type IdentifiedItem = {
  readonly id: string;
};

type ActiveItemIds = {
  readonly hero: string | null;
  readonly 'shortcut-grid': string | null;
  readonly 'image-blocks': string | null;
};

const activeTab = ref<HomepageEditorTab>('hero');
const activeItemId = ref<string | null>(null);

function resolveActiveItemId(
  items: readonly IdentifiedItem[],
  selectedItemId: string | null,
): string | null {
  return items.some(({ id }) => id === selectedItemId)
    ? selectedItemId
    : (items[0]?.id ?? null);
}

function resolveActiveItemIds(): ActiveItemIds {
  return {
    hero: resolveActiveItemId(props.draft.hero.slides, activeItemId.value),
    'shortcut-grid': resolveActiveItemId(
      props.draft.shortcutGrid.items,
      activeItemId.value,
    ),
    'image-blocks': resolveActiveItemId(
      props.draft.imageBlocks,
      activeItemId.value,
    ),
  };
}

const activeItemIds = computed(resolveActiveItemIds);

function selectTab(tab: HomepageEditorTab): void {
  activeTab.value = tab;
  activeItemId.value = null;
}

function selectItem(itemId: string): void {
  activeItemId.value = itemId;
}

function findItemTab(itemId: string): HomepageEditorTab | null {
  if (props.draft.hero.slides.some(({ id }) => id === itemId)) return 'hero';
  if (props.draft.shortcutGrid.items.some(({ id }) => id === itemId)) {
    return 'shortcut-grid';
  }
  if (props.draft.imageBlocks.some(({ id }) => id === itemId)) {
    return 'image-blocks';
  }
  if (itemId === props.draft.customerService.id) return 'customer-service';
  if (itemId === props.draft.shortcutGrid.id) return 'shortcut-grid';
  if (itemId === props.draft.hero.id) return 'hero';
  if (itemId === 'image-blocks') return 'image-blocks';
  return null;
}

function openItem(itemId: string): void {
  const tab = findItemTab(itemId);
  if (!tab) return;
  activeTab.value = tab;
  selectItem(itemId);
}

defineExpose({ openItem });

function updateDraft(patch: Partial<HomepageDraftConfig>): void {
  emit('update:draft', { ...props.draft, ...patch });
}

async function changeShortcutLayout(layout: HomepageGridLayout): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `切换为 ${layout} 宫格会移除末尾多余入口，是否继续？`,
      '确认缩减宫格',
      {
        type: 'warning',
        confirmButtonText: '继续切换',
        cancelButtonText: '取消',
      },
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
    <nav class="homepage-editor-form__tabs" aria-label="首页配置类型">
      <button
        v-for="tab in HOMEPAGE_EDITOR_TABS"
        :key="tab.key"
        type="button"
        :class="{ 'is-active': activeTab === tab.key }"
        :data-editor-tab="tab.key"
        @click="selectTab(tab.key)"
      >
        <small>{{ tab.eyebrow }}</small>
        <span>{{ tab.label }}</span>
      </button>
    </nav>

    <div class="homepage-editor-form__panel">
      <HeroCarouselEditor
        v-if="activeTab === 'hero'"
        data-editor-panel="hero"
        :section="draft.hero"
        :categories="categories"
        :products="products"
        :active-slide-id="activeItemIds.hero"
        @select-slide="selectItem"
        @update:section="updateDraft({ hero: $event })"
      />
      <CustomerServiceEditor
        v-else-if="activeTab === 'customer-service'"
        data-editor-panel="customer-service"
        :section="draft.customerService"
        @update:section="updateDraft({ customerService: $event })"
      />
      <ShortcutGridEditor
        v-else-if="activeTab === 'shortcut-grid'"
        data-editor-panel="shortcut-grid"
        :section="draft.shortcutGrid"
        :categories="categories"
        :products="products"
        :active-item-id="activeItemIds['shortcut-grid']"
        @select-item="selectItem"
        @update:section="updateDraft({ shortcutGrid: $event })"
        @request-layout-change="changeShortcutLayout"
      />
      <ImageBlocksEditor
        v-else
        data-editor-panel="image-blocks"
        :blocks="draft.imageBlocks"
        :categories="categories"
        :products="products"
        :active-block-id="activeItemIds['image-blocks']"
        @select-block="selectItem"
        @update:blocks="updateDraft({ imageBlocks: $event })"
      />
    </div>
  </form>
</template>

<style scoped>
.homepage-editor-form {
  display: grid;
  gap: 14px;
}

.homepage-editor-form__tabs,
.homepage-editor-form :deep(.homepage-item-tabs) {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-color: color-mix(in srgb, var(--admin-mint) 42%, transparent)
    transparent;
  scrollbar-width: thin;
}

.homepage-editor-form__tabs {
  position: sticky;
  z-index: 3;
  top: 0;
  padding: 4px;
  border: 1px solid var(--admin-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--admin-surface) 94%, transparent);
  box-shadow: 0 10px 28px rgb(73 57 105 / 8%);
  backdrop-filter: blur(14px);
}

.homepage-editor-form__tabs button,
.homepage-editor-form :deep(.homepage-item-tabs button) {
  flex: 0 0 auto;
  border: 0;
  color: var(--admin-muted);
  cursor: pointer;
  font: inherit;
}

.homepage-editor-form__tabs button {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  gap: 7px;
  padding: 10px 12px;
  border-radius: 12px;
  background: transparent;
}

.homepage-editor-form__tabs small {
  color: var(--admin-mint);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.homepage-editor-form__tabs button.is-active {
  background: color-mix(in srgb, var(--admin-mint) 14%, var(--admin-surface));
  color: var(--admin-text);
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--admin-mint) 28%, transparent);
}

.homepage-editor-form__tabs::-webkit-scrollbar,
.homepage-editor-form :deep(.homepage-item-tabs::-webkit-scrollbar) {
  width: 6px;
  height: 6px;
}

.homepage-editor-form__tabs::-webkit-scrollbar-thumb,
.homepage-editor-form :deep(.homepage-item-tabs::-webkit-scrollbar-thumb) {
  border-radius: 999px;
  background: color-mix(in srgb, var(--admin-mint) 46%, transparent);
}

.homepage-editor-form__panel {
  min-width: 0;
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

.homepage-editor-form :deep(.homepage-item-tabs) {
  margin-bottom: 14px;
  padding-bottom: 2px;
}

.homepage-editor-form :deep(.homepage-item-tabs button) {
  min-width: 82px;
  padding: 8px 11px;
  border: 1px solid var(--admin-border);
  border-radius: 999px;
  background: var(--admin-surface-soft);
  font-size: 12px;
}

.homepage-editor-form :deep(.homepage-item-tabs button.is-active) {
  border-color: color-mix(in srgb, var(--admin-mint) 48%, var(--admin-border));
  background: color-mix(in srgb, var(--admin-mint) 16%, var(--admin-surface));
  color: var(--admin-text);
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

.homepage-editor-form
  :deep(.homepage-editor-card__actions .el-button + .el-button) {
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
