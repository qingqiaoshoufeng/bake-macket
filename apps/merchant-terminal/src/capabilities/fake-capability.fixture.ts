import {
  parseVerifiedCapability,
  type PocPrinterCapability,
} from './poc-capability.js';

export const FAKE_PRINTER_CAPABILITY: PocPrinterCapability =
  parseVerifiedCapability({
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
  });
