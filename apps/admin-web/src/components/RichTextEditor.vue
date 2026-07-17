<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElButton, ElInput } from 'element-plus';

import {
  isAllowedImageUrl,
  isAllowedLinkUrl,
  sanitizeRichTextHtml,
} from './richTextHtml.js';

/**
 * Minimalist rich-text editor for product detail HTML.
 *
 * The brief allows a fallback to a textarea for the MVP, but the design
 * spec calls for "受控富文本详情" and the product editor previews the
 * saved HTML through `v-html`. We therefore ship a thin
 * `contenteditable`-backed surface:
 *
 * - Toolbar buttons wrap the selection in `b`, `i` and `p` tags and allow
 *   inserting links and image URLs.
 * - The component owns the inner DOM via `contenteditable` and re-emits
 *   `update:modelValue` whenever the inner HTML changes (`input` event).
 * - For headless environments (vitest's jsdom does not render focus or
 *   selection), the editor falls back to a textarea bound to the same
 *   model so tests can still drive the value through `setValue`.
 *
 * A future upgrade can swap the contenteditable surface for TipTap /
 * Quill without changing the parent's contract (`v-model:html`).
 */

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const textareaValue = ref(props.modelValue);
const editorRef = ref<HTMLDivElement | null>(null);

const isFallback = computed(() => typeof document === 'undefined');

function syncHtml(next: string): void {
  const sanitizedHtml = sanitizeRichTextHtml(next);
  if (editorRef.value && editorRef.value.innerHTML !== sanitizedHtml) {
    editorRef.value.innerHTML = sanitizedHtml;
  }
  textareaValue.value = sanitizedHtml;
}

onMounted(() => syncHtml(props.modelValue));
watch(() => props.modelValue, syncHtml);

function emitValue(value: string): void {
  if (value === props.modelValue) return;
  emit('update:modelValue', value);
}

function onInput(event: Event): void {
  const target = event.target as HTMLDivElement;
  const sanitizedHtml = sanitizeRichTextHtml(target.innerHTML);
  if (target.innerHTML !== sanitizedHtml) target.innerHTML = sanitizedHtml;
  textareaValue.value = sanitizedHtml;
  emitValue(sanitizedHtml);
}

function onTextareaInput(value: string): void {
  const sanitizedHtml = sanitizeRichTextHtml(value);
  textareaValue.value = sanitizedHtml;
  emitValue(sanitizedHtml);
}

function getTransferredHtml(event: ClipboardEvent | DragEvent): string {
  const transfer =
    'clipboardData' in event ? event.clipboardData : event.dataTransfer;
  return (
    transfer?.getData('text/html') || transfer?.getData('text/plain') || ''
  );
}

function insertSanitizedTransferredHtml(
  event: ClipboardEvent | DragEvent,
): void {
  event.preventDefault();
  const html = getTransferredHtml(event);
  if (!html || isFallback.value) return;
  exec('insertHTML', sanitizeRichTextHtml(html));
}

function exec(command: string, value?: string): void {
  if (isFallback.value) return;
  editorRef.value?.focus();
  // execCommand is deprecated but the only portable way to wrap selection
  // across browsers without shipping a full editor. Its resulting HTML is
  // still cleaned before it can leave this component.
  document.execCommand(command, false, value);
  if (editorRef.value)
    emitValue(sanitizeRichTextHtml(editorRef.value.innerHTML));
}

function onLink(): void {
  const url = window.prompt('请输入链接地址(以 https:// 开头)');
  if (!url || !isAllowedLinkUrl(url)) return;
  exec('createLink', url);
}

function onImage(): void {
  const url = window.prompt('请输入图片地址(以 https:// 开头)');
  if (!url || !isAllowedImageUrl(url)) return;
  exec('insertImage', url);
}
</script>

<template>
  <div class="rich-editor">
    <div v-if="!isFallback" class="rich-editor__toolbar" role="toolbar">
      <ElButton size="small" @click="exec('bold')">
        <span style="font-weight: 700">B</span>
      </ElButton>
      <ElButton size="small" @click="exec('italic')">
        <span style="font-style: italic">I</span>
      </ElButton>
      <ElButton size="small" @click="exec('formatBlock', 'p')"> 段落 </ElButton>
      <ElButton size="small" @click="onLink"> 链接 </ElButton>
      <ElButton size="small" @click="onImage"> 图片 </ElButton>
    </div>

    <div
      v-if="!isFallback"
      ref="editorRef"
      class="rich-editor__surface"
      data-testid="rich-editor-surface"
      :data-placeholder="placeholder ?? '请输入商品详情'"
      contenteditable="true"
      @input="onInput"
      @paste="insertSanitizedTransferredHtml"
      @drop="insertSanitizedTransferredHtml"
    ></div>

    <ElInput
      v-else
      type="textarea"
      :rows="8"
      :model-value="textareaValue"
      :placeholder="placeholder ?? '请输入商品详情'"
      @update:model-value="onTextareaInput"
    />
  </div>
</template>

<style scoped>
.rich-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rich-editor__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  background: var(--admin-lilac);
  padding: 6px 8px;
  border-radius: var(--el-border-radius-base);
}

.rich-editor__surface {
  min-height: 200px;
  border: 1px solid #ece6f7;
  border-radius: var(--el-border-radius-base);
  padding: 12px 14px;
  background: #fff;
  color: #2f2a3d;
  font-size: 14px;
  line-height: 1.6;
  outline: none;
}

.rich-editor__surface:focus {
  border-color: var(--el-color-primary);
}

.rich-editor__surface:empty::before {
  content: attr(data-placeholder);
  color: #b6aecf;
}
</style>
