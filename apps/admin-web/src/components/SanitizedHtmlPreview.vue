<script setup lang="ts">
import { computed } from 'vue';

import { sanitizeRichTextHtml } from './richTextHtml.js';

const props = defineProps<{
  readonly html: string;
}>();

const sanitizedHtml = computed(() => sanitizeRichTextHtml(props.html));
</script>

<template>
  <!-- This is the single trusted HTML rendering boundary; all input is sanitized above. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="sanitized-html-preview" v-html="sanitizedHtml"></div>
</template>

<style scoped>
.sanitized-html-preview {
  color: var(--admin-text);
  font-size: 14px;
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.sanitized-html-preview :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin-block: 12px;
  border-radius: var(--admin-radius-control);
}

.sanitized-html-preview :deep(a) {
  color: var(--admin-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
