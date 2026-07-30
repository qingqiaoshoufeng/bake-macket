<script setup lang="ts">
import type {
  AdminCategoryView,
  AdminProductSummaryView,
  HomepageDraftConfig,
  HomepageImageBlockSection,
  MediaAsset,
} from '@bake-mall/contracts';
import { ElButton, ElFormItem, ElInput, ElSwitch } from 'element-plus';

import CosImageUploader from '../../../components/CosImageUploader.vue';
import { createImageBlock } from '../config/defaults.js';
import HomepageLinkEditor from './HomepageLinkEditor.vue';

const props = defineProps<{
  readonly blocks: HomepageDraftConfig['imageBlocks'];
  readonly categories: readonly AdminCategoryView[];
  readonly products: readonly AdminProductSummaryView[];
}>();

const emit = defineEmits<{
  'update:blocks': [value: HomepageDraftConfig['imageBlocks']];
}>();

function updateBlock(
  index: number,
  patch: Partial<HomepageImageBlockSection<MediaAsset | null>>,
): void {
  emit(
    'update:blocks',
    props.blocks.map((block, currentIndex) =>
      currentIndex === index ? { ...block, ...patch } : { ...block },
    ),
  );
}

function addBlock(): void {
  if (props.blocks.length >= 12) return;
  emit('update:blocks', [
    ...props.blocks.map((block) => ({ ...block })),
    createImageBlock(),
  ]);
}

function removeBlock(index: number): void {
  emit(
    'update:blocks',
    props.blocks.filter((_block, currentIndex) => currentIndex !== index),
  );
}

function moveBlock(index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= props.blocks.length) return;
  emit(
    'update:blocks',
    props.blocks.map((_block, currentIndex) => {
      if (currentIndex === index) return { ...props.blocks[target] };
      if (currentIndex === target) return { ...props.blocks[index] };
      return { ...props.blocks[currentIndex] };
    }),
  );
}
</script>

<template>
  <section id="image-blocks" class="homepage-editor-section">
    <header class="homepage-editor-section__header">
      <div>
        <span>04 · 配图区</span>
        <h2>最多 12 个可排序内容画面</h2>
      </div>
      <ElButton :disabled="blocks.length >= 12" @click="addBlock">
        添加配图区（{{ blocks.length }}/12）
      </ElButton>
    </header>

    <p v-if="blocks.length === 0" class="homepage-editor-empty">
      配图区可留空；需要时再添加。
    </p>
    <div v-else class="homepage-editor-list">
      <article
        v-for="(block, index) in blocks"
        :id="block.id"
        :key="block.id"
        class="homepage-editor-card"
      >
        <header>
          <strong>配图区 {{ index + 1 }}</strong>
          <div class="homepage-editor-card__actions">
            <ElSwitch
              :model-value="block.enabled"
              active-text="启用"
              @update:model-value="updateBlock(index, { enabled: Boolean($event) })"
            />
            <ElButton :disabled="index === 0" @click="moveBlock(index, -1)">上移</ElButton>
            <ElButton
              :disabled="index === blocks.length - 1"
              @click="moveBlock(index, 1)"
            >
              下移
            </ElButton>
            <ElButton type="danger" plain @click="removeBlock(index)">删除</ElButton>
          </div>
        </header>
        <CosImageUploader
          scope="homepage"
          :model-value="block.image"
          preview-aspect-ratio="16 / 9"
          scene-hint="建议使用横向宽图"
          @update:model-value="updateBlock(index, { image: $event })"
        />
        <div class="homepage-editor-grid">
          <ElFormItem label="标题">
            <ElInput
              :model-value="block.title"
              maxlength="80"
              @update:model-value="updateBlock(index, { title: String($event) })"
            />
          </ElFormItem>
          <ElFormItem label="图片替代文字">
            <ElInput
              :model-value="block.altText"
              maxlength="160"
              @update:model-value="updateBlock(index, { altText: String($event) })"
            />
          </ElFormItem>
        </div>
        <ElFormItem label="说明">
          <ElInput
            type="textarea"
            :rows="2"
            :model-value="block.description"
            maxlength="240"
            @update:model-value="updateBlock(index, { description: String($event) })"
          />
        </ElFormItem>
        <HomepageLinkEditor
          :model-value="block.link"
          :categories="categories"
          :products="products"
          @update:model-value="updateBlock(index, { link: $event })"
        />
      </article>
    </div>
  </section>
</template>
