export type UserColumn = {
  readonly key: string;
  readonly label: string;
  readonly minWidth?: number;
  readonly width?: number;
};

export const USER_COLUMNS: readonly UserColumn[] = [
  { key: 'identity', label: '用户', minWidth: 210 },
  { key: 'phone', label: '手机号', width: 150 },
  { key: 'verified', label: '手机号状态', width: 112 },
  { key: 'operator', label: '操作员状态', minWidth: 165 },
  { key: 'createdAt', label: '创建时间', width: 168 },
  { key: 'actions', label: '操作', width: 150 },
];
