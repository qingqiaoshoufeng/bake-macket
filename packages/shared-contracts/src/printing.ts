import {
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
} from './enums.js';
import type { PaginatedView } from './admin-list.js';

export const CLOUD_PRINTER_SERIAL_NUMBER_PATTERN = /^[A-Za-z0-9-]{1,64}$/u;
export const CLOUD_PRINTER_DISPLAY_NAME_MAX_LENGTH = 64;

export function normalizeCloudPrinterSerialNumber(
  value: string,
): string | null {
  const normalized = value.trim();
  return CLOUD_PRINTER_SERIAL_NUMBER_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function normalizeCloudPrinterDisplayName(value: string): string | null {
  const normalized = value.trim();
  const codePointLength = Array.from(normalized).length;
  return codePointLength >= 1 &&
    codePointLength <= CLOUD_PRINTER_DISPLAY_NAME_MAX_LENGTH
    ? normalized
    : null;
}

export function displayNameContainsSensitiveSerial(
  displayName: string,
  serialNumber: string,
): boolean {
  const normalizedDisplayName = displayName.trim().toLowerCase();
  const normalizedSerialNumber = serialNumber.trim().toLowerCase();
  return normalizedSerialNumber.length <= 4
    ? normalizedDisplayName === normalizedSerialNumber
    : normalizedDisplayName.includes(normalizedSerialNumber);
}

export type PrinterVerificationChallengeView = {
  challengeId: string;
  expiresAt: string;
  remainingAttempts: number;
};

export type CloudPrinterView = {
  id: string;
  displayName: string;
  serialNumberMasked: string;
  status: CloudPrinterStatus;
  onlineStatus: CloudPrinterOnlineStatus;
  lastStatusCheckedAt: string | null;
  bindingStage?: PrinterBindingStage;
  vendorRelationState?: VendorRelationState;
  challenge?: PrinterVerificationChallengeView;
};

export type BindCloudPrinterRequest = {
  serialNumber: string;
  displayName: string;
  operationPassword: string;
};

export type BindCloudPrinterResult = {
  printer: CloudPrinterView;
  challenge: PrinterVerificationChallengeView;
};

export type ConfirmCloudPrinterRequest = {
  challengeId: string;
  code: string;
  operationPassword: string;
};

export type ConfirmCloudPrinterResult = {
  printer: CloudPrinterView;
};

export type ResendCloudPrinterVerificationRequest = {
  operationPassword: string;
};

export type ResendCloudPrinterVerificationResult = {
  printer: CloudPrinterView;
  challenge: PrinterVerificationChallengeView;
};

export type RefreshCloudPrinterOnlineStatusRequest = Record<string, never>;

export type RefreshCloudPrinterOnlineStatusResult = {
  printer: CloudPrinterView;
};

export type RequeryCloudPrinterVendorRelationRequest = {
  operationPassword: string;
};

export type RequeryCloudPrinterVendorRelationResult = {
  printer: CloudPrinterView;
};

export type ConfirmCloudPrinterCompensationDeletionRequest = {
  operationPassword: string;
};

export type ConfirmCloudPrinterCompensationDeletionResult = {
  printer: CloudPrinterView;
};

export type RenameCloudPrinterRequest = {
  displayName: string;
};

export type RenameCloudPrinterResult = {
  printer: CloudPrinterView;
};

export type CloudPrinterListQuery = {
  page: number;
  pageSize: number;
  includeUnbound?: boolean;
};

export type CloudPrinterListResult = PaginatedView<CloudPrinterView>;
