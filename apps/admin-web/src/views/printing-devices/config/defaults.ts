import type {
  BindPrinterForm,
  RecoveryPrinterForm,
  RenamePrinterForm,
  VerifyPrinterForm,
} from '../type/index.js';

export const PRINTER_PAGINATION: Readonly<{
  defaultPage: number;
  defaultPageSize: number;
  pageSizes: readonly number[];
}> = Object.freeze({
  defaultPage: 1,
  defaultPageSize: 20,
  pageSizes: [20, 50, 100] as const,
});

export function createBindPrinterDefaults(): BindPrinterForm {
  return { serialNumber: '', displayName: '', operationPassword: '' };
}

export function createVerifyPrinterDefaults(
  challengeId = '',
): VerifyPrinterForm {
  return { challengeId, code: '', operationPassword: '' };
}

export function createRecoveryPrinterDefaults(): RecoveryPrinterForm {
  return { operationPassword: '' };
}

export function createRenamePrinterDefaults(
  displayName = '',
): RenamePrinterForm {
  return { displayName };
}
