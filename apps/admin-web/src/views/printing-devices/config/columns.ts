export type PrinterColumn = {
  readonly key: string;
  readonly label: string;
  readonly minWidth?: number;
  readonly width?: number;
};

export const PRINTER_COLUMNS: readonly PrinterColumn[] = [
  { key: 'identity', label: '打印机', minWidth: 210 },
  { key: 'binding', label: '绑定状态', width: 140 },
  { key: 'online', label: '在线状态', width: 120 },
  { key: 'checkedAt', label: '最后检查', width: 168 },
  { key: 'actions', label: '操作', minWidth: 330 },
];
