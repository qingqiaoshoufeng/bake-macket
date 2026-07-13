import { reactive, ref, computed, watch, type Ref, type ComputedRef } from 'vue';

import { yuanToCents } from '../../../utils/money.js';

/**
 * Pure data shapes consumed by the SKU editor.
 *
 * The view layer mirrors the parent `modelValue` shape so the editor
 * stays a controlled component. Once a row fails validation the parent
 * will *not* receive an `update:modelValue` event — it is up to the
 * parent to keep its in-flight draft and resync the editor when the
 * merchant fixes the offending field.
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
  /** Stable local id so `v-for` keys survive server-id-less drafts. */
  rowId: string;
  id?: string;
  name: string;
  /** Free-form yuan string so the UI can show trailing zeros. */
  priceYuan: string;
  priceCents: number;
  stock: number;
  enabled: boolean;
  imageUrl?: string;
};

export type UseSkuEditorResult = {
  rows: Ref<SkuRow[]>;
  invalidStock: ReturnType<typeof reactive<Set<string>>>;
  hasInvalidRows: ComputedRef<boolean>;
  hasEmptyName: ComputedRef<boolean>;
  addRow: () => void;
  removeRow: (rowId: string) => void;
  setName: (rowId: string, value: string) => void;
  setPriceYuan: (rowId: string, value: string) => void;
  setStock: (rowId: string, value: number | null | undefined) => void;
  setEnabled: (rowId: string, value: boolean) => void;
  /** Returns the rows to emit, or `null` if the working copy is invalid. */
  toInput: () => SkuInput[] | null;
};

const rowIdCounter = { value: 0 };

function nextRowId(): string {
  rowIdCounter.value += 1;
  return `row-${rowIdCounter.value}`;
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

/**
 * Encapsulated SKU editor state.
 *
 * The hook returns plain setters that the view binds to native form
 * controls; this is the only place where yuan→cent conversion and
 * negative-stock blocking lives so the presentational component can
 * stay declarative and the test surface stays a small contract.
 */
export function useSkuEditor(
  initial: () => SkuInput[] = () => [],
): UseSkuEditorResult {
  const rows = ref<SkuRow[]>(initial().map(fromInput));
  const invalidStock = reactive<Set<string>>(new Set());

  const hasInvalidRows = computed(() => invalidStock.size > 0);
  const hasEmptyName = computed(() =>
    rows.value.some((row) => row.name.trim() === ''),
  );

  function findRow(rowId: string): SkuRow | undefined {
    return rows.value.find((row) => row.rowId === rowId);
  }

  function addRow(): void {
    rows.value = [...rows.value, blankRow()];
  }

  function removeRow(rowId: string): void {
    rows.value = rows.value.filter((row) => row.rowId !== rowId);
    invalidStock.delete(rowId);
  }

  function setName(rowId: string, value: string): void {
    const row = findRow(rowId);
    if (!row) return;
    rows.value = rows.value.map((candidate) =>
      candidate.rowId === rowId
        ? { ...candidate, name: value }
        : candidate,
    );
  }

  function setPriceYuan(rowId: string, value: string): void {
    const row = findRow(rowId);
    if (!row) return;
    const cleaned = value.trim();
    if (cleaned === '') {
      rows.value = rows.value.map((candidate) =>
        candidate.rowId === rowId
          ? { ...candidate, priceYuan: '', priceCents: 0 }
          : candidate,
      );
      return;
    }
    const cents = yuanToCents(cleaned);
    rows.value = rows.value.map((candidate) =>
      candidate.rowId === rowId
        ? { ...candidate, priceYuan: (cents / 100).toFixed(2), priceCents: cents }
        : candidate,
    );
  }

  function setStock(rowId: string, value: number | null | undefined): void {
    const row = findRow(rowId);
    if (!row) return;
    const numeric = typeof value === 'number' ? value : Number(value ?? 0);
    if (numeric < 0) {
      invalidStock.add(rowId);
      rows.value = rows.value.map((candidate) =>
        candidate.rowId === rowId ? { ...candidate, stock: numeric } : candidate,
      );
      return;
    }
    invalidStock.delete(rowId);
    rows.value = rows.value.map((candidate) =>
      candidate.rowId === rowId ? { ...candidate, stock: numeric } : candidate,
    );
  }

  function setEnabled(rowId: string, value: boolean): void {
    rows.value = rows.value.map((candidate) =>
      candidate.rowId === rowId ? { ...candidate, enabled: value } : candidate,
    );
  }

  function toInput(): SkuInput[] | null {
    if (hasInvalidRows.value || hasEmptyName.value) return null;
    // The MVP editor only forwards rows that the merchant has fully
    // "committed": a non-empty name, a positive integer-cent price and a
    // strictly positive stock. Rows still being typed (price left at the
    // `0.00` default or stock at `0`) stay as drafts so the parent never
    // persists a half-typed SKU.
    const ready = rows.value.every(
      (row) =>
        row.name.trim() !== '' && row.priceCents > 0 && row.stock > 0,
    );
    if (!ready) return null;
    return rows.value.map<SkuInput>((row) => {
      const input: SkuInput = {
        name: row.name,
        priceCents: row.priceCents,
        stock: row.stock,
        enabled: row.enabled,
      };
      if (row.id) input.id = row.id;
      if (row.imageUrl) input.imageUrl = row.imageUrl;
      return input;
    });
  }

  watch(
    () => initial(),
    (next) => {
      const sameShape =
        next.length === rows.value.length &&
        next.every((item, index) => item.id === rows.value[index]?.id);
      if (sameShape) return;
      rows.value = next.length ? next.map(fromInput) : [];
      invalidStock.clear();
    },
  );

  return {
    rows,
    invalidStock,
    hasInvalidRows,
    hasEmptyName,
    addRow,
    removeRow,
    setName,
    setPriceYuan,
    setStock,
    setEnabled,
    toInput,
  };
}
