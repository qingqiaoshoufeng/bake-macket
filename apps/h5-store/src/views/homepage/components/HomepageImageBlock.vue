<script setup lang="ts">
import {
  HomepageLinkType,
  type HomepageImageBlockSection,
  type HomepageLink,
} from '@bake-mall/contracts';
import { ref } from 'vue';

const props = defineProps<{
  readonly block: HomepageImageBlockSection<{ imageUrl: string }>;
}>();

const emit = defineEmits<{
  navigate: [link: HomepageLink];
}>();
const imageFailed = ref(false);

function open(): void {
  if (props.block.link.type !== HomepageLinkType.NONE) {
    emit('navigate', props.block.link);
  }
}
</script>

<template>
  <component
    :is="block.link.type === HomepageLinkType.NONE ? 'article' : 'button'"
    v-if="block.enabled"
    :type="block.link.type === HomepageLinkType.NONE ? undefined : 'button'"
    class="homepage-image-block"
    @click="open"
  >
    <img
      v-if="!imageFailed"
      :src="block.image.imageUrl"
      :alt="block.altText || block.title"
      @error="imageFailed = true"
    />
    <span v-else class="homepage-image-block__fallback">图片暂时无法显示</span>
    <span v-if="block.title || block.description" class="homepage-image-block__copy">
      <strong>{{ block.title }}</strong>
      <small>{{ block.description }}</small>
    </span>
  </component>
</template>

<style scoped>
.homepage-image-block {
  position: relative;
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--mall-radius-feature);
  background: var(--mall-surface-soft);
  box-shadow: var(--mall-shadow-card);
  color: inherit;
  font: inherit;
  text-align: left;
}

button.homepage-image-block {
  cursor: pointer;
}

.homepage-image-block img {
  display: block;
  width: 100%;
  height: auto;
}

.homepage-image-block__fallback {
  display: grid;
  min-height: 180px;
  place-items: center;
  color: var(--mall-text-muted);
  font-size: 12px;
}

.homepage-image-block__copy {
  position: absolute;
  inset: auto 0 0;
  display: grid;
  gap: 4px;
  padding: 54px var(--mall-space-4) var(--mall-space-4);
  background: linear-gradient(transparent, rgb(24 39 28 / 72%));
  color: #fff;
}

.homepage-image-block__copy strong {
  font-size: 18px;
}

.homepage-image-block__copy small {
  line-height: 1.5;
}
</style>
