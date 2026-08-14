import {
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  type CloudPrinterView,
} from '@bake-mall/contracts';

export type PrinterAction =
  'verify' | 'resend' | 'refresh' | 'requery' | 'delete-confirm' | 'rename';

export const PRINTER_ACTION_LABELS: Readonly<Record<PrinterAction, string>> = {
  verify: '输入验证码',
  resend: '重发验证码',
  refresh: '刷新状态',
  requery: '重新查询',
  'delete-confirm': '确认补偿删除',
  rename: '重命名',
};

export function actionsForPrinter(
  printer: CloudPrinterView,
): readonly PrinterAction[] {
  if (printer.status === CloudPrinterStatus.ACTIVE) {
    return ['refresh', 'rename'];
  }
  if (
    printer.status === CloudPrinterStatus.ERROR &&
    printer.bindingStage === PrinterBindingStage.COMPENSATION_DELETE
  ) {
    return ['delete-confirm', 'rename'];
  }
  if (printer.bindingStage === PrinterBindingStage.UNBIND_DELETE) {
    return ['rename'];
  }
  if (
    printer.status === CloudPrinterStatus.PENDING_VERIFICATION &&
    (printer.bindingStage === PrinterBindingStage.NONE ||
      printer.bindingStage === PrinterBindingStage.PRINT_VERIFICATION_CODE)
  ) {
    return ['verify', 'resend', 'rename'];
  }
  if (
    (printer.status === CloudPrinterStatus.BINDING ||
      printer.status === CloudPrinterStatus.ERROR) &&
    printer.vendorRelationState === VendorRelationState.CONFIRMED_BOUND &&
    (printer.bindingStage === PrinterBindingStage.PRINT_VERIFICATION_CODE ||
      printer.bindingStage === PrinterBindingStage.RECONCILIATION)
  ) {
    return ['resend', 'rename'];
  }
  if (
    printer.status === CloudPrinterStatus.BINDING ||
    printer.status === CloudPrinterStatus.ERROR
  ) {
    return ['requery', 'rename'];
  }
  return ['rename'];
}
