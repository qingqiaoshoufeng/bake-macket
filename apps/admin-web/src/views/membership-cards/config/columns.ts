export type MembershipCardColumn = {
  readonly key: string;
  readonly label: string;
  readonly width?: number;
  readonly minWidth?: number;
};

export const MEMBERSHIP_CARD_COLUMNS: readonly MembershipCardColumn[] = [
  { key: 'level', label: '等级配方', minWidth: 180 },
  { key: 'rank', label: 'rank', width: 72 },
  { key: 'price', label: '价格 / 赠送', minWidth: 136 },
  { key: 'discount', label: '折扣', width: 88 },
  { key: 'validDays', label: '有效期', width: 92 },
  { key: 'purchaseCount', label: '已售', width: 76 },
  { key: 'status', label: '状态', width: 90 },
  { key: 'version', label: '版本', width: 76 },
  { key: 'updatedAt', label: '更新时间', minWidth: 150 },
  { key: 'actions', label: '操作', width: 240 },
];
