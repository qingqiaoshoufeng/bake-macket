import {
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  type CloudPrinterView,
} from '@bake-mall/contracts';

export type PrinterAction =
  | 'verify'
  | 'resend'
  | 'refresh'
  | 'requery'
  | 'delete-confirm'
  | 'unbind'
  | 'rename'
  | 'detail'
  | 'set-current'
  | 'clear-current';

export const PRINTER_ACTION_LABELS: Readonly<Record<PrinterAction, string>> = {
  verify: '输入验证码',
  resend: '重发验证码',
  refresh: '刷新状态',
  requery: '检查设备绑定状态',
  'delete-confirm': '确认厂商已移除设备',
  unbind: '移除设备',
  rename: '重命名',
  detail: '查看详情',
  'set-current': '设为当前',
  'clear-current': '清除当前',
};

export function actionsForPrinter(
  printer: CloudPrinterView,
): readonly PrinterAction[] {
  const currentAction: PrinterAction = printer.isCurrent
    ? 'clear-current'
    : 'set-current';
  if (printer.status === CloudPrinterStatus.UNBOUND) return ['detail'];
  if (printer.status === CloudPrinterStatus.ACTIVE) {
    return ['detail', currentAction, 'refresh', 'unbind', 'rename'];
  }
  if (
    printer.status === CloudPrinterStatus.ERROR &&
    printer.bindingStage === PrinterBindingStage.COMPENSATION_DELETE
  ) {
    return ['detail', 'delete-confirm', 'rename'];
  }
  if (
    printer.status === CloudPrinterStatus.ERROR &&
    printer.bindingStage === PrinterBindingStage.UNBIND_DELETE
  ) {
    return ['detail', 'delete-confirm', 'rename'];
  }
  if (
    printer.status === CloudPrinterStatus.PENDING_VERIFICATION &&
    (printer.bindingStage === PrinterBindingStage.NONE ||
      printer.bindingStage === PrinterBindingStage.PRINT_VERIFICATION_CODE)
  ) {
    return ['detail', 'verify', 'resend', 'rename'];
  }
  if (
    (printer.status === CloudPrinterStatus.BINDING ||
      printer.status === CloudPrinterStatus.ERROR) &&
    printer.vendorRelationState === VendorRelationState.CONFIRMED_BOUND &&
    (printer.bindingStage === PrinterBindingStage.PRINT_VERIFICATION_CODE ||
      printer.bindingStage === PrinterBindingStage.RECONCILIATION)
  ) {
    return ['detail', 'resend', 'rename'];
  }
  if (
    printer.status === CloudPrinterStatus.BINDING ||
    printer.status === CloudPrinterStatus.ERROR
  ) {
    return ['detail', 'requery', 'rename'];
  }
  return ['detail', 'rename'];
}
