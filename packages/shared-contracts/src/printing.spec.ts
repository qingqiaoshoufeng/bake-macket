import { describe, expect, it } from 'vitest';

import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  displayNameContainsSensitiveSerial,
  normalizeCloudPrinterDisplayName,
  normalizeCloudPrinterSerialNumber,
  type CloudPrinterView,
} from './index.js';

describe('cloud printer contracts', () => {
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
    const codes = [
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
      ApiErrorCode.IDEMPOTENCY_CONFLICT,
      ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
      ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
    ];

    expect(codes).not.toContain(undefined);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
