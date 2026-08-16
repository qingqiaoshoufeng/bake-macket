import { describe, expect, it } from 'vitest';

import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrintBatchStatus,
  PrintJobStatus,
  PrinterBindingStage,
  PRINTING_API_ERROR_CODES,
  VendorRelationState,
  canTransitionPrintBatch,
  canTransitionPrintJob,
  displayNameContainsSensitiveSerial,
  normalizeCloudPrinterDisplayName,
  normalizeCloudPrinterSerialNumber,
  type CloudPrinterView,
} from './index.js';

describe('cloud printer contracts', () => {
  it('locks complete print batch and job status values', () => {
    expect(PrintBatchStatus).toEqual({
      DRAFT: 'DRAFT',
      READY: 'READY',
      RUNNING: 'RUNNING',
      PAUSED: 'PAUSED',
      COMPLETED: 'COMPLETED',
      COMPLETED_WITH_ISSUES: 'COMPLETED_WITH_ISSUES',
      CANCELLED: 'CANCELLED',
    });
    expect(PrintJobStatus).toEqual({
      PENDING: 'PENDING',
      SUBMITTING: 'SUBMITTING',
      ACCEPTED: 'ACCEPTED',
      FAILED: 'FAILED',
      UNKNOWN: 'UNKNOWN',
      MANUAL_REVIEW: 'MANUAL_REVIEW',
      MANUALLY_CONFIRMED_PRINTED: 'MANUALLY_CONFIRMED_PRINTED',
      MANUALLY_CLOSED: 'MANUALLY_CLOSED',
      CANCELLED: 'CANCELLED',
    });
  });

  it('allows only authoritative print batch transitions', () => {
    expect(canTransitionPrintBatch('DRAFT', 'READY')).toBe(true);
    expect(canTransitionPrintBatch('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransitionPrintBatch('READY', 'RUNNING')).toBe(true);
    expect(canTransitionPrintBatch('READY', 'CANCELLED')).toBe(true);
    expect(canTransitionPrintBatch('RUNNING', 'PAUSED')).toBe(true);
    expect(canTransitionPrintBatch('RUNNING', 'COMPLETED')).toBe(true);
    expect(canTransitionPrintBatch('RUNNING', 'COMPLETED_WITH_ISSUES')).toBe(
      true,
    );
    expect(canTransitionPrintBatch('PAUSED', 'RUNNING')).toBe(true);
    expect(canTransitionPrintBatch('PAUSED', 'COMPLETED')).toBe(true);
    expect(canTransitionPrintBatch('PAUSED', 'COMPLETED_WITH_ISSUES')).toBe(
      true,
    );
    expect(canTransitionPrintBatch('PAUSED', 'CANCELLED')).toBe(true);

    expect(canTransitionPrintBatch('DRAFT', 'RUNNING')).toBe(false);
    expect(canTransitionPrintBatch('RUNNING', 'CANCELLED')).toBe(false);
    expect(canTransitionPrintBatch('COMPLETED', 'RUNNING')).toBe(false);
    expect(canTransitionPrintBatch('CANCELLED', 'READY')).toBe(false);
  });

  it('allows only authoritative print job transitions', () => {
    expect(canTransitionPrintJob('PENDING', 'SUBMITTING')).toBe(true);
    expect(canTransitionPrintJob('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransitionPrintJob('SUBMITTING', 'ACCEPTED')).toBe(true);
    expect(canTransitionPrintJob('SUBMITTING', 'FAILED')).toBe(true);
    expect(canTransitionPrintJob('SUBMITTING', 'UNKNOWN')).toBe(true);
    expect(canTransitionPrintJob('UNKNOWN', 'ACCEPTED')).toBe(true);
    expect(canTransitionPrintJob('UNKNOWN', 'FAILED')).toBe(true);
    expect(canTransitionPrintJob('UNKNOWN', 'MANUAL_REVIEW')).toBe(true);
    expect(
      canTransitionPrintJob('MANUAL_REVIEW', 'MANUALLY_CONFIRMED_PRINTED'),
    ).toBe(true);
    expect(canTransitionPrintJob('MANUAL_REVIEW', 'FAILED')).toBe(true);
    expect(canTransitionPrintJob('MANUAL_REVIEW', 'MANUALLY_CLOSED')).toBe(
      true,
    );

    expect(canTransitionPrintJob('UNKNOWN', 'PENDING')).toBe(false);
    expect(canTransitionPrintJob('FAILED', 'PENDING')).toBe(false);
    expect(canTransitionPrintJob('ACCEPTED', 'FAILED')).toBe(false);
    expect(canTransitionPrintJob('MANUAL_REVIEW', 'ACCEPTED')).toBe(false);
    expect(canTransitionPrintJob('CANCELLED', 'SUBMITTING')).toBe(false);
  });

  it('locks binding, online, vendor relation and recovery stage values', () => {
    expect(CloudPrinterStatus).toEqual({
      BINDING: 'BINDING',
      PENDING_VERIFICATION: 'PENDING_VERIFICATION',
      ACTIVE: 'ACTIVE',
      UNBINDING: 'UNBINDING',
      UNBOUND: 'UNBOUND',
      ERROR: 'ERROR',
    });
    expect(CloudPrinterOnlineStatus).toEqual({
      UNKNOWN: 'UNKNOWN',
      OFFLINE: 'OFFLINE',
      ONLINE: 'ONLINE',
      ABNORMAL: 'ABNORMAL',
    });
    expect(VendorRelationState).toEqual({
      UNKNOWN: 'UNKNOWN',
      CONFIRMED_BOUND: 'CONFIRMED_BOUND',
      CONFIRMED_UNBOUND: 'CONFIRMED_UNBOUND',
    });
    expect(PrinterBindingStage).toEqual({
      NONE: 'NONE',
      ADD_PRINTER: 'ADD_PRINTER',
      PRINT_VERIFICATION_CODE: 'PRINT_VERIFICATION_CODE',
      COMPENSATION_DELETE: 'COMPENSATION_DELETE',
      UNBIND_DELETE: 'UNBIND_DELETE',
      RECONCILIATION: 'RECONCILIATION',
    });
  });

  it.each([
    [' SN-AbC-123 ', 'SN-AbC-123'],
    ['a', 'a'],
    ['A'.repeat(64), 'A'.repeat(64)],
  ])('trims a valid serial number and preserves case', (input, expected) => {
    expect(normalizeCloudPrinterSerialNumber(input)).toBe(expected);
  });

  it.each(['', '   ', 'SN_123', 'SN 123', '中文', 'A'.repeat(65)])(
    'rejects invalid serial number %j',
    (input) => {
      expect(normalizeCloudPrinterSerialNumber(input)).toBeNull();
    },
  );

  it('trims display names and enforces 1-64 Unicode code points', () => {
    expect(normalizeCloudPrinterDisplayName(' 前台 ')).toBe('前台');
    expect(normalizeCloudPrinterDisplayName('   ')).toBeNull();
    expect(normalizeCloudPrinterDisplayName('打'.repeat(64))).toBe(
      '打'.repeat(64),
    );
    expect(normalizeCloudPrinterDisplayName('打'.repeat(65))).toBeNull();
    expect(normalizeCloudPrinterDisplayName('😀'.repeat(64))).toBe(
      '😀'.repeat(64),
    );
    expect(normalizeCloudPrinterDisplayName('😀'.repeat(65))).toBeNull();
  });

  it.each([
    ['Cake Shop', 'A', false],
    ['Printer A', 'A', false],
    [' A ', 'a', true],
    ['门店-sn-abcde-前台', 'SN-AbCdE', true],
    ['SN-AbCdE', 'sn-abcde', true],
    ['门店-SN-AbCd-前台', 'SN-AbCdE', false],
  ] as const)(
    'detects sensitive serial in display name %j / %j as %s',
    (displayName, serialNumber, expected) => {
      expect(
        displayNameContainsSensitiveSerial(displayName, serialNumber),
      ).toBe(expected);
    },
  );

  it('exposes only masked printer identifiers when serialized', () => {
    const fullSerialNumber = 'FULL-SERIAL-123';
    const view: CloudPrinterView = {
      id: '1',
      displayName: '前台',
      serialNumberMasked: 'FU****23',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      onlineStatus: CloudPrinterOnlineStatus.ONLINE,
      lastStatusCheckedAt: '2026-08-04T00:00:00.000Z',
      isCurrent: false,
      challenge: {
        challengeId: '1',
        expiresAt: '2026-08-04T00:05:00.000Z',
        remainingAttempts: 3,
      },
    };
    const serialized = JSON.stringify(view);

    expect(view.serialNumberMasked).toBe('FU****23');
    expect(view.challenge).toEqual({
      challengeId: '1',
      expiresAt: '2026-08-04T00:05:00.000Z',
      remainingAttempts: 3,
    });
    expect(serialized).not.toContain(fullSerialNumber);
    expect(view).not.toHaveProperty('serialNumber');
    expect(view).not.toHaveProperty('serialNumberHash');
    expect(view).not.toHaveProperty('requestHash');
    expect(view).not.toHaveProperty('userKey');
    expect(view).not.toHaveProperty('UserKEY');
    expect(view.challenge).not.toHaveProperty('code');
    expect(view.challenge).not.toHaveProperty('hash');
    expect(view.challenge).not.toHaveProperty('verificationCodeHash');
  });

  it('defines unique printer and idempotency failure categories', () => {
    expect(PRINTING_API_ERROR_CODES).toEqual([
      ApiErrorCode.ADMIN_VERIFICATION_FAILED,
      ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
      ApiErrorCode.ADMIN_PERMISSION_DENIED,
      ApiErrorCode.CLOUD_PRINTER_SERIAL_INVALID,
      ApiErrorCode.CLOUD_PRINTER_NAME_INVALID,
      ApiErrorCode.CLOUD_PRINTER_ALREADY_BOUND,
      ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT,
      ApiErrorCode.CLOUD_PRINTER_VENDOR_LIMIT,
      ApiErrorCode.CLOUD_PRINTER_VENDOR_RATE_LIMITED,
      ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
      ApiErrorCode.CLOUD_PRINTER_VERIFICATION_EXPIRED,
      ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED,
      ApiErrorCode.CLOUD_PRINTER_OFFLINE,
      ApiErrorCode.CLOUD_PRINTER_ONLINE_STATUS_UNKNOWN,
      ApiErrorCode.CLOUD_PRINTER_BINDING_RECOVERY_REQUIRED,
      ApiErrorCode.CLOUD_PRINTER_COMPENSATION_RECOVERY_REQUIRED,
      ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
      ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED,
      ApiErrorCode.CLOUD_PRINTER_VENDOR_UNAVAILABLE,
      ApiErrorCode.CLOUD_PRINTER_UNBIND_BLOCKED,
      ApiErrorCode.CLOUD_PRINTER_NOT_FOUND,
      ApiErrorCode.CLOUD_PRINTER_CURRENT_INELIGIBLE,
      ApiErrorCode.CLOUD_PRINTER_CURRENT_VERSION_CONFLICT,
      ApiErrorCode.CLOUD_PRINTER_CURRENT_UNBIND_FORBIDDEN,
      ApiErrorCode.PRINT_ORDER_NOT_PRINTABLE,
      ApiErrorCode.PRINT_BATCH_NOT_FOUND,
      ApiErrorCode.PRINT_BATCH_STATUS_CONFLICT,
      ApiErrorCode.PRINT_BATCH_APPEND_LIMIT_EXCEEDED,
      ApiErrorCode.PRINT_BATCH_LEASE_CONFLICT,
      ApiErrorCode.PRINT_JOB_NOT_FOUND,
      ApiErrorCode.PRINT_JOB_STATUS_CONFLICT,
      ApiErrorCode.PRINT_JOB_RESULT_UNKNOWN,
      ApiErrorCode.PRINT_JOB_MANUAL_REVIEW_REQUIRED,
      ApiErrorCode.PRINT_JOB_PAYLOAD_REDACTED,
      ApiErrorCode.IDEMPOTENCY_CONFLICT,
      ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
      ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
    ]);
    expect(PRINTING_API_ERROR_CODES).not.toContain(undefined);
    expect(new Set(PRINTING_API_ERROR_CODES).size).toBe(
      PRINTING_API_ERROR_CODES.length,
    );
  });
});
