import type { SaveProductSkuInput } from '@bake-mall/contracts';
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

import { formatCentsToYuan } from '../../../utils/money.js';
import type { SkuAttributeRow, SkuFormRow } from '../type/form.js';

type UseSkuEditorResult = {
  rows: Ref<SkuFormRow[]>;
  hasInvalidRows: ComputedRef<boolean>;
  addRow: () => void;
  removeRow: (rowId: string) => void;
  setName: (rowId: string, value: string) => void;
  setPriceYuan: (rowId: string, value: string) => void;
  setStock: (rowId: string, value: number) => void;
  setActive: (rowId: string, value: boolean) => void;
  setAttributes: (
    rowId: string,
    attributes: readonly SkuAttributeRow[],
  ) => void;
  setImage: (rowId: string, image: SkuFormRow['image']) => void;
  toInput: () => SaveProductSkuInput[] | null;
};

const PRICE_YUAN_PATTERN = /^(0|[1-9]\d*)(\.\d{1,2})?$/;
const MAX_UNSIGNED_INT = 4_294_967_295;
const rowIdCounter = { value: 0 };

function nextRowId(): string {
  rowIdCounter.value += 1;
  return `sku-row-${rowIdCounter.value}`;
}

function cloneAttribute(attribute: SkuAttributeRow): SkuAttributeRow {
  return { ...attribute };
}

function cloneRow(row: SkuFormRow, rowId = row.rowId): SkuFormRow {
  return {
    ...row,
    rowId,
    attributes: row.attributes.map(cloneAttribute),
    image: row.image ? { ...row.image } : null,
  };
}

function createBlankRow(): SkuFormRow {
  return {
    rowId: nextRowId(),
    name: '',
    attributes: [],
    priceYuan: '0.00',
    stock: 0,
    isActive: true,
    image: null,
  };
}

function normalizeAttributes(
  attributes: readonly SkuAttributeRow[],
): readonly SkuAttributeRow[] {
  const normalized = attributes.map(({ key, value }) => ({
    key: key.trim(),
    value: value.trim(),
  }));
  if (normalized.some(({ key }) => key === '')) {
    throw new Error('SKU 属性键不能为空');
  }
  const keys = normalized.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) {
    throw new Error('SKU 属性键不能重复');
  }
  return normalized;
}

function parsePriceYuan(value: string): number {
  const normalized = value.trim();
  if (!PRICE_YUAN_PATTERN.test(normalized)) {
    throw new Error('价格最多保留两位小数');
  }
  const [yuan, decimal = ''] = normalized.split('.');
  const cents =
    Number.parseInt(yuan, 10) * 100 +
    Number.parseInt(decimal.padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(cents) || cents > MAX_UNSIGNED_INT) {
    throw new Error('价格超出允许范围');
  }
  return cents;
}

function isValidRow(row: SkuFormRow): boolean {
  try {
    parsePriceYuan(row.priceYuan);
    return (
      row.name.trim() !== '' && Number.isInteger(row.stock) && row.stock >= 0
    );
  } catch {
    return false;
  }
}

function rowSnapshot(row: SkuFormRow): string {
  return JSON.stringify({
    id: row.id,
    stockVersion: row.stockVersion,
    name: row.name,
    attributes: row.attributes,
    priceYuan: row.priceYuan,
    stock: row.stock,
    isActive: row.isActive,
    image: row.image,
  });
}

function rowsSnapshot(rows: readonly SkuFormRow[]): string {
  return JSON.stringify(rows.map(rowSnapshot));
}

function mergeIncomingRows(
  current: readonly SkuFormRow[],
  incoming: readonly SkuFormRow[],
): SkuFormRow[] {
  return incoming.map((row, index) => {
    const matching = row.id
      ? current.find((candidate) => candidate.id === row.id)
      : current[index]?.id === undefined
        ? current[index]
        : undefined;
    return cloneRow(row, matching?.rowId ?? row.rowId ?? nextRowId());
  });
}

export function useSkuEditor(
  initialRows: () => readonly SkuFormRow[] = () => [],
): UseSkuEditorResult {
  const rows = ref<SkuFormRow[]>(initialRows().map((row) => cloneRow(row)));
  const hasInvalidRows = computed(() =>
    rows.value.some((row) => !isValidRow(row)),
  );

  function updateRow(
    rowId: string,
    update: (row: SkuFormRow) => SkuFormRow,
  ): void {
    rows.value = rows.value.map((row) =>
      row.rowId === rowId ? update(row) : row,
    );
  }

  function addRow(): void {
    rows.value = [...rows.value, createBlankRow()];
  }

  function removeRow(rowId: string): void {
    rows.value = rows.value.flatMap((row) => {
      if (row.rowId !== rowId) return [row];
      return row.id ? [{ ...row, isActive: false }] : [];
    });
  }

  function setName(rowId: string, name: string): void {
    updateRow(rowId, (row) => ({ ...row, name }));
  }

  function setPriceYuan(rowId: string, priceYuan: string): void {
    parsePriceYuan(priceYuan);
    updateRow(rowId, (row) => ({ ...row, priceYuan: priceYuan.trim() }));
  }

  function setStock(rowId: string, stock: number): void {
    if (!Number.isInteger(stock) || stock < 0) {
      throw new Error('库存必须是非负整数');
    }
    updateRow(rowId, (row) => ({ ...row, stock }));
  }

  function setActive(rowId: string, isActive: boolean): void {
    updateRow(rowId, (row) => ({ ...row, isActive }));
  }

  function setAttributes(
    rowId: string,
    attributes: readonly SkuAttributeRow[],
  ): void {
    const normalized = normalizeAttributes(attributes);
    updateRow(rowId, (row) => ({ ...row, attributes: normalized }));
  }

  function setImage(rowId: string, image: SkuFormRow['image']): void {
    updateRow(rowId, (row) => ({ ...row, image }));
  }

  function toInput(): SaveProductSkuInput[] | null {
    if (hasInvalidRows.value) return null;
    return rows.value.map((row): SaveProductSkuInput => {
      const fields = {
        name: row.name.trim(),
        attributes: Object.fromEntries(
          normalizeAttributes(row.attributes).map(({ key, value }) => [
            key,
            value,
          ]),
        ),
        priceCents: parsePriceYuan(row.priceYuan),
        stock: row.stock,
        isActive: row.isActive,
        image: row.image,
      };
      if (row.id !== undefined) {
        if (row.stockVersion === undefined) {
          throw new Error('已有 SKU 缺少库存版本');
        }
        return { ...fields, id: row.id, stockVersion: row.stockVersion };
      }
      if (row.stockVersion !== undefined) {
        throw new Error('新 SKU 不能包含库存版本');
      }
      return fields;
    });
  }

  watch(
    () => rowsSnapshot(initialRows()),
    () => {
      const incoming = initialRows();
      if (rowsSnapshot(incoming) === rowsSnapshot(rows.value)) return;
      rows.value = mergeIncomingRows(rows.value, incoming);
    },
  );

  return {
    rows,
    hasInvalidRows,
    addRow,
    removeRow,
    setName,
    setPriceYuan,
    setStock,
    setActive,
    setAttributes,
    setImage,
    toInput,
  };
}

export { formatCentsToYuan };
