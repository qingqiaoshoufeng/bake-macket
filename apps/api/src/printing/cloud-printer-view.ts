import {
  CloudPrinterStatus,
  displayNameContainsSensitiveSerial,
  type CloudPrinterView,
} from '@bake-mall/contracts';

import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';

const VERIFICATION_MAX_ATTEMPTS = 5;

type CloudPrinterResult = Readonly<{
  printer: CloudPrinterView | null;
}>;

type CurrentCloudPrinterReader = Readonly<{
  get(): Promise<CloudPrinterResult>;
}>;

function maskSerialNumber(serial: string): string {
  if (serial.length <= 4) return '*'.repeat(serial.length);
  return `${serial.slice(0, 2)}${'*'.repeat(Math.max(2, serial.length - 4))}${serial.slice(-2)}`;
}

function safeDisplayName(printer: CloudPrinter): string {
  return displayNameContainsSensitiveSerial(
    printer.displayName,
    printer.serialNumber,
  )
    ? `打印机 ${maskSerialNumber(printer.serialNumber)}`
    : printer.displayName;
}

function challengeView(printer: CloudPrinter): CloudPrinterView['challenge'] {
  if (
    printer.verificationCodeHash === null ||
    printer.verificationExpiresAt === null ||
    printer.status !== CloudPrinterStatus.PENDING_VERIFICATION
  ) {
    return undefined;
  }
  return {
    challengeId: printer.id,
    expiresAt: printer.verificationExpiresAt.toISOString(),
    remainingAttempts: Math.max(
      0,
      VERIFICATION_MAX_ATTEMPTS - printer.verificationFailedAttempts,
    ),
  };
}

function baseView(printer: CloudPrinter, isCurrent: boolean): CloudPrinterView {
  const challenge = challengeView(printer);
  return {
    id: printer.id,
    displayName: safeDisplayName(printer),
    serialNumberMasked: maskSerialNumber(printer.serialNumber),
    status: printer.status,
    onlineStatus: printer.lastOnlineStatus,
    lastStatusCheckedAt: printer.lastStatusCheckedAt
      ? printer.lastStatusCheckedAt.toISOString()
      : null,
    isCurrent,
    ...(challenge ? { challenge } : {}),
  };
}

export function toView(
  printer: CloudPrinter,
  isCurrent = false,
): CloudPrinterView {
  return {
    ...baseView(printer, isCurrent),
    bindingStage: printer.bindingStage,
    vendorRelationState: printer.vendorRelationState,
  };
}

export function toSnapshotView(
  printer: CloudPrinter,
  isCurrent = false,
): CloudPrinterView {
  return baseView(printer, isCurrent);
}

export function normalizeCloudPrinterSnapshot<T>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== 'object' || !('printer' in snapshot)) {
    return snapshot;
  }
  const printer = (snapshot as { printer?: unknown }).printer;
  if (!printer || typeof printer !== 'object') return snapshot;
  const isCurrent = (printer as { isCurrent?: unknown }).isCurrent;
  return {
    ...snapshot,
    printer: {
      ...printer,
      isCurrent: typeof isCurrent === 'boolean' ? isCurrent : false,
    },
  } as T;
}

export async function projectCloudPrinterResult<T>(
  result: T,
  currentPrinters?: CurrentCloudPrinterReader,
): Promise<T> {
  if (!result || typeof result !== 'object' || !('printer' in result)) {
    return result;
  }
  const printer = (result as CloudPrinterResult).printer;
  if (
    !printer ||
    typeof printer !== 'object' ||
    typeof printer.id !== 'string'
  ) {
    return result;
  }
  const current = currentPrinters ? await currentPrinters.get() : null;
  return {
    ...result,
    printer: {
      ...printer,
      isCurrent: printer.id === current?.printer?.id,
    },
  } as T;
}
