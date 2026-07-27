import type { MediaAsset } from '@bake-mall/contracts';
import { nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';

import type { SkuFormRow } from '../type/form.js';
import { useSkuEditor } from './useSkuEditor.js';

const image: MediaAsset = {
  objectKey: 'products/sku.webp',
  publicUrl: 'https://cdn.example.com/products/sku.webp',
};

function existingRow(overrides: Partial<SkuFormRow> = {}): SkuFormRow {
  return {
    rowId: 'detail-sku-1',
    id: 'sku-1',
    stockVersion: 3,
    name: '6寸',
    attributes: [{ key: 'size', value: '6寸' }],
    priceYuan: '68.50',
    stock: 0,
    isActive: true,
    image: null,
    ...overrides,
  };
}

describe('useSkuEditor', () => {
  it('accepts zero stock and produces the existing-SKU wire union', () => {
    const editor = useSkuEditor(() => [existingRow()]);

    expect(editor.toInput()).toEqual([
      {
        id: 'sku-1',
        stockVersion: 3,
        name: '6寸',
        attributes: { size: '6寸' },
        priceCents: 6850,
        stock: 0,
        isActive: true,
        image: null,
      },
    ]);
  });

  it.each(['68.501', '-1', '', '01', '1.', '42949672.96', '90071992547409.92'])(
    'retains invalid yuan draft %j while refusing to serialize it',
    (value) => {
      const editor = useSkuEditor(() => [existingRow()]);

      editor.setPriceYuan('detail-sku-1', value);

      expect(editor.rows.value[0]?.priceYuan).toBe(value);
      expect(editor.hasInvalidRows.value).toBe(true);
      expect(editor.toInput()).toBeNull();
    },
  );

  it.each([
    ['0', 0],
    ['68', 6800],
    ['68.5', 6850],
    ['68.50', 6850],
  ])('parses valid yuan input %j exactly', (value, priceCents) => {
    const editor = useSkuEditor(() => [existingRow()]);
    editor.setPriceYuan('detail-sku-1', value);
    expect(editor.toInput()?.[0]?.priceCents).toBe(priceCents);
  });

  it('retains duplicate attribute-key drafts while refusing to serialize them', () => {
    const editor = useSkuEditor(() => [existingRow()]);
    const invalidAttributes = [
      { key: ' 口味 ', value: ' 草莓 ' },
      { key: '口味', value: '巧克力' },
    ];

    editor.setAttributes('detail-sku-1', invalidAttributes);

    expect(editor.rows.value[0]?.attributes).toEqual(invalidAttributes);
    expect(editor.hasInvalidRows.value).toBe(true);
    expect(editor.toInput()).toBeNull();

    editor.setAttributes('detail-sku-1', [{ key: ' 口味 ', value: ' 草莓 ' }]);
    expect(editor.toInput()?.[0]?.attributes).toEqual({ 口味: '草莓' });
  });

  it('retains an invalid stock draft while refusing to serialize it', () => {
    const editor = useSkuEditor(() => [existingRow()]);

    editor.setStock('detail-sku-1', -1);

    expect(editor.rows.value[0]?.stock).toBe(-1);
    expect(editor.hasInvalidRows.value).toBe(true);
    expect(editor.toInput()).toBeNull();
  });

  it('marks an existing row inactive and removes a new row', () => {
    const editor = useSkuEditor(() => [existingRow()]);

    editor.removeRow('detail-sku-1');
    expect(editor.toInput()?.[0]).toMatchObject({
      id: 'sku-1',
      stockVersion: 3,
      isActive: false,
    });

    editor.addRow();
    const newRowId = editor.rows.value.at(-1)?.rowId;
    if (!newRowId) throw new Error('Expected a new row');
    editor.removeRow(newRowId);
    expect(editor.rows.value).toHaveLength(1);
  });

  it('rejects an existing row whose stockVersion is missing', () => {
    const editor = useSkuEditor(() => [
      existingRow({ stockVersion: undefined }),
    ]);
    expect(() => editor.toInput()).toThrow('已有 SKU 缺少库存版本');
  });

  it('fully syncs same-id parent changes while preserving the stable rowId', async () => {
    const initialRows = ref<readonly SkuFormRow[]>([existingRow()]);
    const editor = useSkuEditor(() => initialRows.value);
    const stableRowId = editor.rows.value[0]?.rowId;
    const nextImage = { ...image, objectKey: 'products/sku-new.webp' };

    initialRows.value = [
      existingRow({
        rowId: 'different-parent-row-id',
        name: '8寸',
        stock: 9,
        stockVersion: 4,
        attributes: [{ key: '口味', value: '巧克力' }],
        image: nextImage,
      }),
    ];
    await nextTick();

    expect(editor.rows.value[0]).toEqual({
      ...initialRows.value[0],
      rowId: stableRowId,
    });
  });
});
