<script setup lang="ts">
import {
  HomepageLinkType,
  type AdminCategoryView,
  type AdminProductSummaryView,
  type HomepageDraftConfig,
  type HomepageHeroSlide,
  type MediaAsset,
} from '@bake-mall/contracts';
import {
  ElButton,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
  ElSwitch,
} from 'element-plus';

import CosImageUploader from '../../../components/CosImageUploader.vue';
import { AUTOPLAY_OPTIONS } from '../config/options.js';
import HomepageLinkEditor from './HomepageLinkEditor.vue';

const props = defineProps<{
  readonly section: HomepageDraftConfig['hero'];
  readonly categories: readonly AdminCategoryView[];
  readonly products: readonly AdminProductSummaryView[];
  readonly activeSlideId: string | null;
  readonly issueItemIds: readonly string[];
}>();

const emit = defineEmits<{
  'update:section': [value: HomepageDraftConfig['hero']];
  'select-slide': [slideId: string];
}>();

function updateSection(patch: Partial<HomepageDraftConfig['hero']>): void {
  emit('update:section', { ...props.section, ...patch });
}

function updateSlide(
  index: number,
  patch: Partial<HomepageHeroSlide<MediaAsset | null>>,
): void {
  updateSection({
    slides: props.section.slides.map((slide, currentIndex) =>
      currentIndex === index ? { ...slide, ...patch } : { ...slide },
    ),
  });
}

function addSlide(): void {
  if (props.section.slides.length >= 10) return;
  updateSection({
    slides: [
      ...props.section.slides.map((slide) => ({ ...slide })),
      {
        id: `hero-slide-${crypto.randomUUID()}`,
        image: null,
        title: '',
        subtitle: '',
        altText: '',
        link: { type: HomepageLinkType.NONE },
      },
    ],
  });
}

function removeSlide(index: number): void {
  updateSection({
    slides: props.section.slides.filter(
      (_slide, currentIndex) => currentIndex !== index,
    ),
  });
}
</script>

<template>
  <section :id="section.id" class="homepage-editor-section">
    <header class="homepage-editor-section__header">
      <div>
        <span>01 · 首屏轮播</span>
        <h2>铺满首屏的品牌画面</h2>
      </div>
      <ElSwitch
        :model-value="section.enabled"
        active-text="显示"
        @update:model-value="updateSection({ enabled: Boolean($event) })"
      />
    </header>

    <ElFormItem label="自动播放">
      <ElSelect
        :model-value="section.autoplayMs"
        @update:model-value="
          updateSection({
            autoplayMs: Number($event) as 0 | 3000 | 5000 | 8000,
          })
        "
      >
        <ElOption
          v-for="option in AUTOPLAY_OPTIONS"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </ElSelect>
    </ElFormItem>

    <div
      v-if="section.slides.length"
      class="homepage-repeater homepage-repeater--vertical"
    >
      <nav class="homepage-item-tabs" aria-label="轮播图配置">
        <button
          v-for="(slide, index) in section.slides"
          :key="slide.id"
          type="button"
          :class="{ 'is-active': slide.id === activeSlideId }"
          :data-item-tab="slide.id"
          @click="emit('select-slide', slide.id)"
        >
          轮播图 {{ index + 1 }}
          <i
            v-if="issueItemIds.includes(slide.id)"
            class="homepage-validation-dot"
            data-validation-dot
            aria-label="有未填写项"
          />
        </button>
      </nav>
      <div class="homepage-editor-list">
        <article
          v-for="(slide, index) in section.slides"
          v-show="slide.id === activeSlideId"
          :id="slide.id"
          :key="slide.id"
          class="homepage-editor-card"
        >
          <header>
            <strong>轮播图 {{ index + 1 }}</strong>
            <ElButton type="danger" plain @click="removeSlide(index)"
              >删除</ElButton
            >
          </header>
          <CosImageUploader
            compact
            scope="homepage"
            :model-value="slide.image"
            preview-aspect-ratio="750 / 1334"
            scene-hint="建议竖屏 750×1334"
            @update:model-value="updateSlide(index, { image: $event })"
          />
          <div class="homepage-editor-grid">
            <ElFormItem label="标题">
              <ElInput
                :model-value="slide.title"
                maxlength="80"
                @update:model-value="
                  updateSlide(index, { title: String($event) })
                "
              />
            </ElFormItem>
            <ElFormItem label="副标题">
              <ElInput
                :model-value="slide.subtitle"
                maxlength="160"
                @update:model-value="
                  updateSlide(index, { subtitle: String($event) })
                "
              />
            </ElFormItem>
            <ElFormItem label="图片替代文字">
              <ElInput
                :model-value="slide.altText"
                maxlength="160"
                @update:model-value="
                  updateSlide(index, { altText: String($event) })
                "
              />
            </ElFormItem>
          </div>
          <HomepageLinkEditor
            :model-value="slide.link"
            :categories="categories"
            :products="products"
            @update:model-value="updateSlide(index, { link: $event })"
          />
        </article>
      </div>
    </div>
    <p v-else class="homepage-editor-empty">
      还没有轮播图，发布前至少添加一张。
    </p>
    <ElButton :disabled="section.slides.length >= 10" @click="addSlide">
      添加轮播图（{{ section.slides.length }}/10）
    </ElButton>
  </section>
</template>
