<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElButton, ElInput, ElInputNumber, ElSwitch, ElTag } from 'element-plus';

/**
 * SKU editor embedded in the product editor (Task 12). The editor holds a
 * local working copy of the parent's SKU list — a flat list of `{ id?,
 * name, priceYuan, stock, enabled, imageUrl? }` rows — and only emits
 * `update:modelValue` once every row validates.
 *
 * Validation rules pinned by the design spec + this task:
 *
 * - `priceYuan` accepts non-negative numbers with up to 2 decimal places.
 *   The on-wire shape is integer cents (`priceCents = round(yuan * 100)`)
 *   so the parent can POST `Math.round(Number(yuan) * 100)` directly to
 *   `POST /admin/products/:id/skus`. `.toFixed(2)` is used when normalising
 *   the displayed string so subsequent parsing is stable.
 * - `stock` must be ≥ 0; negative values render a Chinese error message
 *   and prevent the emit, so the merchant cannot persist illegal stock.
 * - At least one row is required before the editor considers the form
 *   valid; this is enforced by the parent (the product editor blocks save
 *   with an empty SKU list).
 *
 * The component never reaches for `fetch`; persistence is the parent's
 * responsibility, which keeps this surface easy to unit-test.
 */

export type SkuInput = {
  id?: string;
  name: string;
  priceCents: number;
  stock: number;
  enabled: boolean;
  imageUrl?: string;
};

export type SkuRow = {
  /** Stable local id so v-for key is local, not the server id. */
  rowId: string;
  id?: string;
  name: string;
  /** Edited as a free-form yuan string so the UI can show trailing zeros. */
  priceYuan: string;
  priceCents: number;
  stock: number;
  enabled: boolean;
  imageUrl?: string;
};

const props = defineProps<{
  modelValue: SkuInput[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: SkuInput[]];
}>();

/**
 * Convert an internal row into the wire shape the parent consumes. Stock
 * validation happens before this is called so any negative value never
 * reaches the emit.
 */
function toInput(row: SkuRow): SkuInput {
  const input: SkuInput = {
    name: row.name,
    priceCents: row.priceCents,
    stock: row.stock,
    enabled: row.enabled,
  };
  if (row.id) input.id = row.id;
  if (row.imageUrl) input.imageUrl = row.imageUrl;
  return input;
}

function nextRowId(): string {
  return `row-${Math.random().toString(36).slice(2, 10)}`;
}

function blankRow(): SkuRow {
  return {
    rowId: nextRowId(),
    name: '',
    priceYuan: '0.00',
    priceCents: 0,
    stock: 0,
    enabled: true,
  };
}

function fromInput(input: SkuInput): SkuRow {
  const cents = Number.isFinite(input.priceCents) ? input.priceCents : 0;
  return {
    rowId: nextRowId(),
    ...(input.id ? { id: input.id } : {}),
    name: input.name,
    priceYuan: (cents / 100).toFixed(2),
    priceCents: cents,
    stock: input.stock,
    enabled: input.enabled,
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
  };
}

const rows = ref<SkuRow[]>(
  props.modelValue.length ? props.modelValue.map(fromInput) : [],
);

/**
 * Track which rows currently fail stock validation. `Set` keeps delete +
 * re-render O(1) without rebuilding the row list. Empty by default so the
 * UI is clean until the merchant enters an invalid value.
 */
const invalidStock = reactive<Set<string>>(new Set());

const hasInvalidRows = computed(() => invalidStock.size > 0);

const hasEmptyName = computed(() =>
  rows.value.some((row) => row.name.trim() === ''),
);

function emitValid(): void {
  if (hasInvalidRows.value || hasEmptyName.value) return;
  emit(
    'update:modelValue',
    rows.value.map(toInput),
  );
}

function addRow(): void {
  rows.value.push(blankRow());
}

function removeRow(rowId: string): void {
  rows.value = rows.value.filter((row) => row.rowId !== rowId);
  invalidStock.delete(rowId);
  emitValid();
}

function onNameChange(rowId: string): void {
  emitValid();
}

function onPriceChange(rowId: string): void {
  const row = rows.value.find((candidate) => candidate.rowId === rowId);
  if (!row) return;
  const cleaned = row.priceYuan.trim();
  // Allow blank input during typing but re-emit 0 cents so the parent
  // never sees an undefined value.
  if (cleaned === '') {
    row.priceCents = 0;
    emitValid();
    return;
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric < 0) {
    row.priceCents = 0;
    emitValid();
    return;
  }
  // Two-decimal clamp: any digit past the hundredths place is dropped so
  // the on-wire integer cents are stable.
  row.priceCents = Math.round(numeric * 100);
  row.priceYuan = (row.priceCents / 100).toFixed(2);
  emitValid();
}

function onStockChange(rowId: string, value: number | null | undefined): void {
  const row = rows.value.find((candidate) => candidate.rowId === rowId);
  if (!row) return;
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  if (numeric < 0) {
    invalidStock.add(rowId);
    row.stock = numeric;
    return;
  }
  invalidStock.delete(rowId);
  row.stock = numeric;
  emitValid();
}

function onEnabledChange(rowId: string, value: boolean): void {
  const row = rows.value.find((candidate) => candidate.rowId === rowId);
  if (!row) return;
  row.enabled = value;
  emitValid();
}

function rowError(rowId: string): string | null {
  return invalidStock.has(rowId) ? '库存不能小于 0' : null;
}

defineExpose({
  addRow,
});

watch(
  () => props.modelValue,
  (next) => {
    // Re-sync only when the parent supplies a different list (e.g. after
    // a successful save clears the working copy). We compare ids so a
    // re-emit with the same content does not blow away in-flight edits.
    const sameShape =
      next.length === rows.value.length &&
      next.every((item, index) => item.id === rows.value[index]?.id);
    if (sameShape) return;
    rows.value = next.length ? next.map(fromInput) : [];
    invalidStock.clear();
  },
);
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
        <tr v-for="(row, index) in rows" :key="row.rowId">
          <td>
            <ElInput
              :model-value="row.name"
              :data-testid="`name-${index}`"
              placeholder="例如 6寸 / 榴莲味"
              @update:model-value="(value: string) => {
                row.name = value;
                onNameChange(row.rowId);
              }"
            />
          </td>
          <td>
            <ElInput
              :model-value="row.priceYuan"
              :data-testid="`price-${index}`"
              placeholder="0.00"
              @update:model-value="(value: string) => {
                row.priceYuan = value;
                onPriceChange(row.rowId);
              }"
            >
              <template #append>元</template>
            </ElInput>
          </td>
          <td>
            <div class="sku-editor__stock-cell">
              <ElInputNumber
                :model-value="row.stock"
                :data-testid="`stock-${index}`"
                :min="0"
                :step="1"
                :controls="false"
                @update:model-value="(value) => onStockChange(row.rowId, value)"
              />
              <ElTag
                v-if="rowError(row.rowId)"
                type="danger"
                size="small"
                :data-testid="`stock-error-${index}`"
              >
                {{ rowError(row.rowId) }}
              </ElTag>
            </div>
          </td>
          <td>
            <ElSwitch
              :model-value="row.enabled"
              :data-testid="`enabled-${index}`"
              @update:model-value="(value) => onEnabledChange(row.rowId, value)"
            />
          </td>
          <td>
            <ElButton
              link
              type="danger"
              :data-testid="`remove-${index}`"
              @click="removeRow(row.rowId)"
            >
              删除
            </ElButton>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="5" class="sku-editor__empty">
            尚未添加 SKU,点击下方按钮新增。
          </td>
        </tr>
      </tbody>
    </table>
    <div class="sku-editor__toolbar">
      <ElButton
        type="primary"
        plain
        :data-testid="'add-sku'"
        @click="addRow"
      >
        新增 SKU
      </ElButton>
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

.sku-editor__empty {
  text-align: center;
  color: #8a83a3;
  padding: 18px 0;
}

.sku-editor__stock-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sku-editor__toolbar {
  display: flex;
  justify-content: flex-end;
}
</style>