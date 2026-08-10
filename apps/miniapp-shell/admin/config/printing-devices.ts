import {
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  type CloudPrinterView,
} from '@bake-mall/contracts';

import type { PrintingDeviceAction } from '../type/printing-devices.js';

export const PRINTING_DEVICE_PAGE_SIZE = 20;
export const PRINTER_ACTION_LABELS: Readonly<
  Record<PrintingDeviceAction, string>
> = Object.freeze({
  verify: '输入验证码',
  resend: '重发验证码',
  refresh: '刷新在线状态',
  requery: '重新查询绑定关系',
  'delete-confirm': '确认补偿删除',
  rename: '重命名',
});

export function actionsForPrinter(
  printer: CloudPrinterView,
): readonly PrintingDeviceAction[] {
  if (printer.status === CloudPrinterStatus.ACTIVE)
    return ['refresh', 'rename'];
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
