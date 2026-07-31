<script setup lang="ts">
import type {
  AdminCategoryView,
  AdminProductSummaryView,
  HomepageDraftConfig,
  HomepageGridLayout,
  HomepageShortcutItem,
  MediaAsset,
} from '@bake-mall/contracts';
import {
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
  ElSwitch,
} from 'element-plus';

import CosImageUploader from '../../../components/CosImageUploader.vue';
import { resizeShortcutItems } from '../config/defaults.js';
import { GRID_LAYOUT_OPTIONS } from '../config/options.js';
import HomepageLinkEditor from './HomepageLinkEditor.vue';

const props = defineProps<{
  readonly section: HomepageDraftConfig['shortcutGrid'];
  readonly categories: readonly AdminCategoryView[];
  readonly products: readonly AdminProductSummaryView[];
  readonly activeItemId: string | null;
  readonly issueItemIds: readonly string[];
}>();

const emit = defineEmits<{
  'update:section': [value: HomepageDraftConfig['shortcutGrid']];
  'request-layout-change': [layout: HomepageGridLayout];
  'select-item': [itemId: string];
}>();

function updateSection(
  patch: Partial<HomepageDraftConfig['shortcutGrid']>,
): void {
  emit('update:section', { ...props.section, ...patch });
}

function updateItem(
  index: number,
  patch: Partial<HomepageShortcutItem<MediaAsset | null>>,
): void {
  updateSection({
    items: props.section.items.map((item, currentIndex) =>
      currentIndex === index ? { ...item, ...patch } : { ...item },
    ),
  });
}

function requestLayout(layout: HomepageGridLayout): void {
  if (layout < props.section.items.length) {
    emit('request-layout-change', layout);
    return;
  }
  updateSection({
    layout,
    items: resizeShortcutItems(props.section.items, layout),
  });
}
</script>

<template>
  <section :id="section.id" class="homepage-editor-section">
    <header class="homepage-editor-section__header">
      <div>
        <span>03 · 宫格入口</span>
        <h2>选择 3 / 4 / 5 / 6 / 9 宫格</h2>
      </div>
      <ElSwitch
        :model-value="section.enabled"
        active-text="显示"
        @update:model-value="updateSection({ enabled: Boolean($event) })"
      />
    </header>

    <div class="homepage-editor-grid">
      <ElFormItem label="区块标题">
        <ElInput
          :model-value="section.title"
          maxlength="80"
          @update:model-value="updateSection({ title: String($event) })"
        />
      </ElFormItem>
      <ElFormItem label="宫格数量">
        <ElSelect
          :model-value="section.layout"
          @update:model-value="
            requestLayout(Number($event) as HomepageGridLayout)
          "
        >
          <ElOption
            v-for="layout in GRID_LAYOUT_OPTIONS"
            :key="layout"
            :label="`${layout} 宫格`"
            :value="layout"
          />
        </ElSelect>
      </ElFormItem>
    </div>

    <div class="homepage-repeater homepage-repeater--vertical">
      <nav class="homepage-item-tabs" aria-label="宫格入口配置">
        <button
          v-for="(item, index) in section.items"
          :key="item.id"
          type="button"
          :class="{ 'is-active': item.id === activeItemId }"
          :data-item-tab="item.id"
          @click="emit('select-item', item.id)"
        >
          入口 {{ index + 1 }}
          <i
            v-if="issueItemIds.includes(item.id)"
            class="homepage-validation-dot"
            data-validation-dot
            aria-label="有未填写项"
          />
        </button>
      </nav>

      <div class="homepage-editor-list">
        <article
          v-for="(item, index) in section.items"
          v-show="item.id === activeItemId"
          :id="item.id"
          :key="item.id"
          class="homepage-editor-card"
        >
          <header>
            <strong>入口 {{ index + 1 }}</strong>
          </header>
          <CosImageUploader
            compact
            scope="homepage"
            :model-value="item.image"
            preview-aspect-ratio="1 / 1"
            scene-hint="建议使用正方形图标"
            @update:model-value="updateItem(index, { image: $event })"
          />
          <ElFormItem label="名称" required>
            <ElInput
              :model-value="item.label"
              maxlength="24"
              @update:model-value="updateItem(index, { label: String($event) })"
            />
          </ElFormItem>
          <HomepageLinkEditor
            :model-value="item.link"
            :categories="categories"
            :products="products"
            @update:model-value="updateItem(index, { link: $event })"
          />
        </article>
      </div>
    </div>
  </section>
</template>
