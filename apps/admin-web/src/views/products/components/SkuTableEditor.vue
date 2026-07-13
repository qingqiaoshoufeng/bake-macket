<script setup lang="ts">
/**
 * SKU table editor for the merchant product editor (Task 12).
 *
 * The component stays purely presentational: every interaction is wired
 * to setters on {@link useSkuEditor}, which is the only place that
 * converts yuan input into integer cents and gates `update:modelValue`
 * behind successful validation. Tests therefore use native `<input>`
 * elements so jsdom's `setValue` can drive the values without depending
 * on Element Plus component internals.
 */

import { useSkuEditor, type SkuInput } from '../hooks/useSkuEditor.js';

const props = defineProps<{
  modelValue: SkuInput[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: SkuInput[]];
}>();

const editor = useSkuEditor(() => props.modelValue);

function emitValid(): void {
  // Only commit the working copy when the entire table is valid; if any
  // row fails validation the merchant sees the inline error and the
  // parent receives no draft, so a partially-typed row can never be
  // persisted.
  if (editor.hasInvalidRows.value || editor.hasEmptyName.value) return;
  const next = editor.toInput();
  if (next === null) return;
  emit('update:modelValue', next);
}

function onAdd(): void {
  // Adding a row is a presentation-only change; the parent should not see
  // a draft until the merchant types a name + price + stock into the row.
  editor.addRow();
}

function onRemove(rowId: string): void {
  editor.removeRow(rowId);
  emitValid();
}

function onNameChange(rowId: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  editor.setName(rowId, value);
  // commit on `change` (fires on blur/Enter) so the parent never sees
  // an in-flight keystroke draft.
  emitValid();
}

function onPriceChange(rowId: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  editor.setPriceYuan(rowId, value);
  emitValid();
}

function onStockChange(rowId: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  editor.setStock(rowId, value === '' ? 0 : Number(value));
  emitValid();
}

function onEnabledChange(rowId: string, event: Event): void {
  const value = (event.target as HTMLInputElement).checked;
  editor.setEnabled(rowId, value);
  emitValid();
}

function rowError(rowId: string): string | null {
  return editor.invalidStock.has(rowId) ? '库存不能小于 0' : null;
}
</script>

<template>
  <div class="sku-editor">
    <table class="sku-editor__table" aria-label="SKU 编辑器">
      <thead>
        <tr>
          <th>规格名</th>
          <th>售价(元)</th>
          <th>库存</th>
          <th>上架</th>
          <th aria-label="操作"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in editor.rows.value" :key="row.rowId">
          <td>
            <input
              :value="row.name"
              :data-testid="`name-${index}`"
              class="sku-editor__input"
              placeholder="例如 6寸 / 榴莲味"
              @change="(event) => onNameChange(row.rowId, event)"
            />
          </td>
          <td>
            <div class="sku-editor__price-cell">
              <input
                :value="row.priceYuan"
                :data-testid="`price-${index}`"
                class="sku-editor__input"
                inputmode="decimal"
                placeholder="0.00"
                @change="(event) => onPriceChange(row.rowId, event)"
              />
              <span class="sku-editor__unit">元</span>
            </div>
          </td>
          <td>
            <div class="sku-editor__stock-cell">
              <input
                :value="row.stock"
                :data-testid="`stock-${index}`"
                class="sku-editor__input"
                type="number"
                min="0"
                step="1"
                @change="(event) => onStockChange(row.rowId, event)"
              />
              <span v-if="rowError(row.rowId)" class="sku-editor__error" :data-testid="`stock-error-${index}`">
                {{ rowError(row.rowId) }}
              </span>
            </div>
          </td>
          <td>
            <label class="sku-editor__switch">
              <input
                type="checkbox"
                :checked="row.enabled"
                :data-testid="`enabled-${index}`"
                @change="(event) => onEnabledChange(row.rowId, event)"
              />
              <span>{{ row.enabled ? '上架' : '下架' }}</span>
            </label>
          </td>
          <td>
            <button
              type="button"
              class="sku-editor__remove"
              :data-testid="`remove-${index}`"
              @click="onRemove(row.rowId)"
            >
              删除
            </button>
          </td>
        </tr>
        <tr v-if="editor.rows.value.length === 0">
          <td colspan="5" class="sku-editor__empty">
            尚未添加 SKU,点击下方按钮新增。
          </td>
        </tr>
      </tbody>
    </table>
    <div class="sku-editor__toolbar">
      <button
        type="button"
        class="sku-editor__add"
        :data-testid="'add-sku'"
        @click="onAdd"
      >
        新增 SKU
      </button>
    </div>
  </div>
</template>

<style scoped>
.sku-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sku-editor__table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
}

.sku-editor__table th,
.sku-editor__table td {
  padding: 8px 12px;
  border-bottom: 1px solid #ece6f7;
  text-align: left;
  font-size: 13px;
  color: #2f2a3d;
  vertical-align: top;
}

.sku-editor__table th {
  background: var(--admin-lilac);
  color: #5e3fb2;
  font-weight: 500;
}

.sku-editor__input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #d8cfe9;
  border-radius: 8px;
  font: inherit;
  background: #fff;
  color: inherit;
}

.sku-editor__input:focus {
  outline: none;
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px rgba(123, 97, 200, 0.18);
}

.sku-editor__price-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sku-editor__unit {
  color: #8a83a3;
  font-size: 12px;
}

.sku-editor__stock-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sku-editor__error {
  color: #d14545;
  font-size: 12px;
}

.sku-editor__switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #5f5980;
  font-size: 13px;
}

.sku-editor__remove,
.sku-editor__add {
  border: 1px solid transparent;
  background: transparent;
  color: var(--el-color-primary);
  font: inherit;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}

.sku-editor__remove {
  color: #d14545;
}

.sku-editor__remove:hover,
.sku-editor__add:hover {
  background: var(--admin-lilac);
}

.sku-editor__add {
  border-color: var(--el-color-primary);
}

.sku-editor__empty {
  text-align: center;
  color: #8a83a3;
  padding: 18px 0;
}

.sku-editor__toolbar {
  display: flex;
  justify-content: flex-end;
}
</style>
