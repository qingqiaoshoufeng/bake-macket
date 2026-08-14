import { describe, expect, it } from 'vitest';

import { parsePrinterDiagnosticForm } from './diagnostic-form.js';

const validForm = {
  host: '192.168.1.100',
  port: '9100',
  encoding: 'GB18030',
  charactersPerLine: '32',
  connectionTimeoutMs: '3000',
  writeTimeoutMs: '5000',
  feedLines: '3',
  supportsCut: false,
  cutCommandHex: '',
  testCut: false,
} as const;

describe('parsePrinterDiagnosticForm', () => {
  it('builds a diagnostic candidate without claiming it is verified', () => {
    expect(parsePrinterDiagnosticForm(validForm)).toEqual({
      host: '192.168.1.100',
      capability: {
        tcpPort: 9100,
        encoding: 'GB18030',
        charactersPerLine: 32,
        connectionTimeoutMs: 3000,
        writeTimeoutMs: 5000,
        feedLines: 3,
        supportsCut: false,
        cutCommandHex: null,
      },
      testCut: false,
    });
  });

  it.each([
    ['invalid IP', { host: 'example.com' }],
    ['invalid port', { port: '0' }],
    ['invalid encoding', { encoding: 'UTF-8' }],
    ['invalid columns', { charactersPerLine: '0' }],
    ['invalid feed', { feedLines: '0' }],
    ['invalid connect timeout', { connectionTimeoutMs: '0' }],
    ['invalid write timeout', { writeTimeoutMs: '0' }],
    [
      'arbitrary cut command',
      { supportsCut: true, testCut: true, cutCommandHex: '1b40' },
    ],
  ])('rejects %s', (_label, override) => {
    expect(
      parsePrinterDiagnosticForm({ ...validForm, ...override }),
    ).toBeNull();
  });
});
