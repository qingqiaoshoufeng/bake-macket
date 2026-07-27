export type ProductColumn = {
  readonly key:
    | 'name'
    | 'categoryName'
    | 'coverImage'
    | 'activeSkuCount'
    | 'sortOrder'
    | 'isActive'
    | 'actions';
  readonly label: string;
  readonly width?: number;
  readonly minWidth?: number;
};

export const PRODUCT_COLUMNS: readonly ProductColumn[] = [
  { key: 'name', label: '名称', minWidth: 180 },
  { key: 'categoryName', label: '分类', minWidth: 120 },
  { key: 'coverImage', label: '主图', width: 100 },
  { key: 'activeSkuCount', label: '启用 SKU 数', width: 120 },
  { key: 'sortOrder', label: '排序', width: 90 },
  { key: 'isActive', label: '上架状态', width: 100 },
  { key: 'actions', label: '操作', width: 150 },
] as const;
