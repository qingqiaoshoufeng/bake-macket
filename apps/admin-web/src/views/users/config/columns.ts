export type UserColumn = {
  readonly key: string;
  readonly label: string;
  readonly minWidth?: number;
  readonly width?: number;
};

export const USER_COLUMNS: readonly UserColumn[] = [
  { key: 'identity', label: '用户', minWidth: 190 },
  { key: 'wechat', label: '微信状态', width: 120 },
  { key: 'identityPhone', label: '身份手机号', width: 150 },
  { key: 'identityPhoneStatus', label: '身份手机号状态', width: 128 },
  { key: 'loginPhone', label: '管理员登录手机号', width: 170 },
  { key: 'operator', label: '操作员状态', minWidth: 150 },
  { key: 'createdAt', label: '创建时间', width: 168 },
  { key: 'actions', label: '操作', width: 150 },
];
