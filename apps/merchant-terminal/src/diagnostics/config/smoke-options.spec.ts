import { describe, expect, it } from 'vitest';

import {
  buildDiagnosticSmokePageUrl,
  parseDiagnosticSmokeOptions,
  parseDiagnosticSmokeUrl,
} from './smoke-options.js';

describe('parseDiagnosticSmokeOptions', () => {
  it('accepts only explicit emulator smoke parameters', () => {
    expect(
      parseDiagnosticSmokeOptions({
        smoke: 'true',
        host: '10.0.2.2',
        port: '49152',
      }),
    ).toEqual({ host: '10.0.2.2', port: 49_152, autoRun: true });
  });

  it.each([
    [{ smoke: 'false', host: '10.0.2.2', port: '49152' }],
    [{ smoke: 'true', host: '192.168.1.8', port: '49152' }],
    [{ smoke: 'true', host: '10.0.2.2', port: '0' }],
    [{ smoke: 'true', host: '10.0.2.2', port: '65536' }],
  ])('rejects unsafe or incomplete smoke options %#', (options) => {
    expect(parseDiagnosticSmokeOptions(options)).toBeNull();
  });

  it('accepts the registered smoke URL and builds the page URL', () => {
    const parsed = parseDiagnosticSmokeUrl(
      'bakemall-terminal://diagnostics?smoke=true&host=10.0.2.2&port=49152',
    );

    expect(parsed).toEqual({ host: '10.0.2.2', port: 49_152, autoRun: true });
    expect(buildDiagnosticSmokePageUrl(parsed!)).toBe(
      '/pages/diagnostics/DiagnosticsPage?smoke=true&host=10.0.2.2&port=49152',
    );
  });

  it.each([
    ['https://example.com/diagnostics?smoke=true&host=10.0.2.2&port=49152'],
    ['bakemall-terminal://settings?smoke=true&host=10.0.2.2&port=49152'],
    ['bakemall-terminal://diagnostics?smoke=true&host=127.0.0.1&port=49152'],
    ['not a url'],
  ])('rejects an unauthorized launch URL: %s', (url) => {
    expect(parseDiagnosticSmokeUrl(url)).toBeNull();
  });
});
