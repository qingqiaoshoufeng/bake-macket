<script setup lang="ts">
import { computed, ref } from 'vue';

import type { MediaAsset } from '@bake-mall/contracts';

import CosImageUploader from '../../../components/CosImageUploader.vue';
import { useSkuEditor } from '../hooks/useSkuEditor.js';
import type { SkuAttributeRow, SkuFormRow } from '../type/form.js';

const props = defineProps<{
  modelValue: readonly SkuFormRow[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: readonly SkuFormRow[]];
  'uploading-change': [value: boolean];
}>();

const editor = useSkuEditor(() => props.modelValue);
const uploadingByRow = ref<Readonly<Record<string, boolean>>>({});
const uploading = computed(() =>
  Object.values(uploadingByRow.value).some(Boolean),
);

function emitRows(): void {
  emit('update:modelValue', editor.rows.value);
}

function onAdd(): void {
  editor.addRow();
  emitRows();
}

function onRemove(rowId: string): void {
  const removedRow = editor.rows.value.find((row) => row.rowId === rowId);
  editor.removeRow(rowId);
  if (!removedRow?.id) {
    const { [rowId]: removed, ...remaining } = uploadingByRow.value;
    void removed;
    uploadingByRow.value = remaining;
  }
  emit('uploading-change', uploading.value);
  emitRows();
}

function onNameChange(rowId: string, event: Event): void {
  editor.setName(rowId, (event.target as HTMLInputElement).value);
  emitRows();
}

function onPriceChange(rowId: string, event: Event): void {
  editor.setPriceYuan(rowId, (event.target as HTMLInputElement).value);
  emitRows();
}

function onStockChange(rowId: string, event: Event): void {
  editor.setStock(rowId, Number((event.target as HTMLInputElement).value));
  emitRows();
}

function onActiveChange(rowId: string, event: Event): void {
  editor.setActive(rowId, (event.target as HTMLInputElement).checked);
  emitRows();
}

function updateAttribute(
  rowId: string,
  attributes: readonly SkuAttributeRow[],
  index: number,
  field: keyof SkuAttributeRow,
  value: string,
): void {
  editor.setAttributes(
    rowId,
    attributes.map((attribute, attributeIndex) =>
      attributeIndex === index ? { ...attribute, [field]: value } : attribute,
    ),
  );
  emitRows();
}

function removeAttribute(
  rowId: string,
  attributes: readonly SkuAttributeRow[],
  index: number,
): void {
  editor.setAttributes(
    rowId,
    attributes.filter((_, attributeIndex) => attributeIndex !== index),
  );
  emitRows();
}

function addAttribute(
  rowId: string,
  attributes: readonly SkuAttributeRow[],
): void {
  const nextIndex = attributes.length + 1;
  editor.setAttributes(rowId, [
    ...attributes,
    { key: `属性${nextIndex}`, value: '' },
  ]);
  emitRows();
}

function onImageChange(rowId: string, image: MediaAsset | null): void {
  editor.setImage(rowId, image);
  emitRows();
}

function onUploadingChange(rowId: string, value: boolean): void {
  uploadingByRow.value = { ...uploadingByRow.value, [rowId]: value };
  emit('uploading-change', uploading.value);
}
</script>

<template>
  <div class="sku-editor">
    <div
      class="sku-editor__scroll admin-horizontal-scroll"
      data-testid="sku-table-scroll"
    >
      <table class="sku-editor__table" aria-label="SKU 编辑器">
        <thead>
          <tr>
            <th>规格名</th>
            <th>属性</th>
            <th>售价(元)</th>
            <th>库存</th>
            <th>图片</th>
            <th>状态</th>
            <th aria-label="操作"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in editor.rows.value" :key="row.rowId">
            <td>
              <input
                :value="row.name"
                :data-testid="`name-${index}`"
                class="sku-editor__input sku-editor__input--name"
                placeholder="例如 6寸"
                @change="onNameChange(row.rowId, $event)"
              />
            </td>
            <td>
              <div class="sku-editor__attributes">
                <div
                  v-for="(attribute, attributeIndex) in row.attributes"
                  :key="`${row.rowId}-${attributeIndex}`"
                  class="sku-editor__attribute"
                >
                  <input
                    :value="attribute.key"
                    :data-testid="`attribute-key-${index}-${attributeIndex}`"
                    class="sku-editor__input"
                    placeholder="属性名"
                    @change="
                      updateAttribute(
                        row.rowId,
                        row.attributes,
                        attributeIndex,
                        'key',
                        ($event.target as HTMLInputElement).value,
                      )
                    "
                  />
                  <input
                    :value="attribute.value"
                    :data-testid="`attribute-value-${index}-${attributeIndex}`"
                    class="sku-editor__input"
                    placeholder="属性值"
                    @change="
                      updateAttribute(
                        row.rowId,
                        row.attributes,
                        attributeIndex,
                        'value',
                        ($event.target as HTMLInputElement).value,
                      )
                    "
                  />
                  <button
                    type="button"
                    @click="
                      removeAttribute(row.rowId, row.attributes, attributeIndex)
                    "
                  >
                    移除
                  </button>
                </div>
                <button
                  type="button"
                  @click="addAttribute(row.rowId, row.attributes)"
                >
                  添加属性
                </button>
              </div>
            </td>
            <td>
              <input
                :value="row.priceYuan"
                :data-testid="`price-${index}`"
                class="sku-editor__input"
                inputmode="decimal"
                @change="onPriceChange(row.rowId, $event)"
              />
            </td>
            <td>
              <input
                :value="row.stock"
                :data-testid="`stock-${index}`"
                class="sku-editor__input"
                type="number"
                min="0"
                step="1"
                @change="onStockChange(row.rowId, $event)"
              />
            </td>
            <td>
              <CosImageUploader
                scope="products"
                :model-value="row.image"
                @update:model-value="onImageChange(row.rowId, $event)"
                @uploading-change="onUploadingChange(row.rowId, $event)"
              />
            </td>
            <td>
              <label>
                <input
                  type="checkbox"
                  :checked="row.isActive"
                  :data-testid="`active-${index}`"
                  @change="onActiveChange(row.rowId, $event)"
                />
                <span>{{ row.isActive ? '上架' : '下架' }}</span>
              </label>
            </td>
            <td>
              <button
                type="button"
                :data-testid="`remove-${index}`"
                @click="onRemove(row.rowId)"
              >
                {{ row.id ? '下架' : '删除' }}
              </button>
            </td>
          </tr>
          <tr v-if="editor.rows.value.length === 0">
            <td colspan="7" class="sku-editor__empty">尚未添加 SKU。</td>
          </tr>
        </tbody>
      </table>
    </div>
    <button
      class="sku-editor__add"
      type="button"
      data-testid="add-sku"
      @click="onAdd"
    >
      + 新增 SKU
    </button>
  </div>
</template>

<style scoped>
.sku-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  max-width: 100%;
}

.sku-editor__scroll {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-control);
  background: var(--admin-surface);
}

.sku-editor__table {
  width: 100%;
  min-width: 1180px;
  border-collapse: collapse;
  background: var(--admin-surface);
}

.sku-editor__table th,
.sku-editor__table td {
  padding: 10px;
  border-bottom: 1px solid var(--admin-border);
  text-align: left;
  vertical-align: top;
}

.sku-editor__table th {
  background: var(--admin-surface-soft);
  color: var(--admin-text);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.sku-editor__table tbody tr:last-child td {
  border-bottom: 0;
}

.sku-editor__input {
  width: 100%;
  min-width: 112px;
  height: 34px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  outline: none;
}

.sku-editor__input:focus {
  border-color: var(--admin-primary);
  box-shadow: 0 0 0 3px rgb(121 101 184 / 12%);
}

.sku-editor__input--name {
  min-width: 140px;
}

.sku-editor__attributes,
.sku-editor__attribute {
  display: grid;
  gap: 6px;
  min-width: 250px;
}

.sku-editor__attribute {
  grid-template-columns: minmax(104px, 1fr) minmax(112px, 1fr) auto;
}

.sku-editor button {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: var(--admin-surface);
  color: var(--admin-primary);
  cursor: pointer;
}

.sku-editor button:hover {
  border-color: var(--admin-primary);
  background: var(--admin-primary-soft);
}

.sku-editor__add {
  align-self: flex-start;
  min-width: 112px;
  font-weight: 700;
}

.sku-editor__empty {
  text-align: center;
  color: var(--admin-muted);
}
</style>
