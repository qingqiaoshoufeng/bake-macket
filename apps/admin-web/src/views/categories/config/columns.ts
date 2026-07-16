/**
 * Column descriptors for the category management table.
 *
 * The view renders an Element Plus `ElTable` and decides which cell goes
 * where by structural slot (`#default`); this file pins the *labels* and
 * minimum widths so a designer can tweak copy without touching component
 * logic. Columns are intentionally read-only data: no event handlers,
 * no template strings, just label pairs.
 */

export type ColumnDef = {
  readonly key:
    | 'name'
    | 'image'
    | 'sortOrder'
    | 'isActive'
    | 'status'
    | 'actions';
  readonly label: string;
  readonly minWidth?: number;
  readonly width?: number;
  readonly align?: 'left' | 'center' | 'right';
};

export const CATEGORY_COLUMNS = [
  { key: 'name', label: '名称', minWidth: 200 },
  { key: 'image', label: '图标/图片', minWidth: 220 },
  { key: 'sortOrder', label: '排序', width: 120 },
  { key: 'isActive', label: '启用', width: 120 },
  { key: 'status', label: '状态', width: 120 },
  { key: 'actions', label: '操作', width: 220, align: 'left' },
] as const satisfies readonly ColumnDef[];
