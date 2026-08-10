import { describe, expect, it } from 'vitest';

import { parseVerifiedCapability } from './poc-capability.js';

const validCapability = {
  model: 'XINYE_XP_58IIH',
  transport: 'RAW_TCP',
  tcpPort: 9100,
  encoding: 'GB18030',
  charactersPerLine: 32,
  asciiWidth: 1,
  cjkWidth: 2,
  feedLines: 3,
  supportsCut: false,
  cutCommandHex: null,
  connectionTimeoutMs: 3000,
  writeTimeoutMs: 5000,
  selfTestReference: 'fake-printer-fixture',
  verifiedAt: '2026-08-02T00:00:00.000Z',
  verificationStatus: 'PASSED',
} as const;

describe('parseVerifiedCapability', () => {
  it('accepts a verified safe printer capability', () => {
    expect(parseVerifiedCapability(validCapability)).toEqual(validCapability);
  });

  it('accepts the standard GS V cut form with a feed parameter', () => {
    expect(
      parseVerifiedCapability({
        ...validCapability,
        supportsCut: true,
        cutCommandHex: '1d564200',
      }).cutCommandHex,
    ).toBe('1d564200');
  });

  it('rejects unknown fields that could persist local printer secrets', () => {
    expect(() =>
      parseVerifiedCapability({
        ...validCapability,
        printerIp: '192.168.1.8',
      }),
    ).toThrow('Unverified printer capability');
  });

  it.each([
    ['unverified result', { verificationStatus: 'FAILED' }],
    ['unsupported encoding', { encoding: 'UTF-8' }],
    ['port below range', { tcpPort: 0 }],
    ['port above range', { tcpPort: 65_536 }],
    ['zero columns', { charactersPerLine: 0 }],
    ['non-positive connection timeout', { connectionTimeoutMs: 0 }],
    ['non-positive write timeout', { writeTimeoutMs: 0 }],
    ['invalid verification date', { verifiedAt: 'not-a-date' }],
    ['missing cut command', { supportsCut: true, cutCommandHex: null }],
    ['invalid cut command', { supportsCut: true, cutCommandHex: '1dVx' }],
    ['arbitrary ESC/POS command', { supportsCut: true, cutCommandHex: '1b40' }],
    ['unexpected cut command', { supportsCut: false, cutCommandHex: '1d5600' }],
  ])('rejects %s', (_label, override) => {
    expect(() =>
      parseVerifiedCapability({ ...validCapability, ...override }),
    ).toThrow('Unverified printer capability');
  });
});
