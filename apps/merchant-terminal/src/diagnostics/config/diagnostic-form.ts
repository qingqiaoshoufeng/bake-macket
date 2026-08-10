import type { PrinterDiagnosticInput } from '../type/index.js';

export type PrinterDiagnosticForm = Readonly<{
  host: string;
  port: string;
  encoding: string;
  charactersPerLine: string;
  connectionTimeoutMs: string;
  writeTimeoutMs: string;
  feedLines: string;
  supportsCut: boolean;
  cutCommandHex: string;
  testCut: boolean;
}>;

const IPV4 =
  /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/u;
const CUT_COMMAND_HEX = /^1d56(?:(?:00|01|30|31)|(?:41|42)[0-9a-f]{2})$/iu;

const integerInRange = (
  value: string,
  minimum: number,
  maximum: number,
): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
};

export const parsePrinterDiagnosticForm = (
  form: PrinterDiagnosticForm,
): PrinterDiagnosticInput | null => {
  const host = form.host.trim();
  const tcpPort = integerInRange(form.port, 1, 65_535);
  const charactersPerLine = integerInRange(form.charactersPerLine, 1, 256);
  const connectionTimeoutMs = integerInRange(
    form.connectionTimeoutMs,
    1,
    60_000,
  );
  const writeTimeoutMs = integerInRange(form.writeTimeoutMs, 1, 60_000);
  const feedLines = integerInRange(form.feedLines, 1, 20);
  const encoding =
    form.encoding === 'GB18030' || form.encoding === 'GBK'
      ? form.encoding
      : null;
  const cutCommandHex = form.cutCommandHex.trim().toLowerCase();
  const validCut =
    (!form.supportsCut && !form.testCut && cutCommandHex === '') ||
    (form.supportsCut && form.testCut && CUT_COMMAND_HEX.test(cutCommandHex));

  if (
    !IPV4.test(host) ||
    tcpPort === null ||
    encoding === null ||
    charactersPerLine === null ||
    connectionTimeoutMs === null ||
    writeTimeoutMs === null ||
    feedLines === null ||
    !validCut
  ) {
    return null;
  }

  return Object.freeze({
    host,
    capability: Object.freeze({
      tcpPort,
      encoding,
      charactersPerLine,
      connectionTimeoutMs,
      writeTimeoutMs,
      feedLines,
      supportsCut: form.supportsCut,
      cutCommandHex: form.supportsCut ? cutCommandHex : null,
    }),
    testCut: form.testCut,
  });
};
