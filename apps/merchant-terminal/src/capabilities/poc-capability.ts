export type PocPrinterCapability = Readonly<{
  model: 'XINYE_XP_58IIH';
  transport: 'RAW_TCP';
  tcpPort: number;
  encoding: 'GB18030' | 'GBK';
  charactersPerLine: number;
  asciiWidth: 1;
  cjkWidth: 2;
  feedLines: number;
  supportsCut: boolean;
  cutCommandHex: string | null;
  connectionTimeoutMs: number;
  writeTimeoutMs: number;
  selfTestReference: string;
  verifiedAt: string;
  verificationStatus: 'PASSED';
}>;

const CUT_COMMAND_HEX = /^1d56(?:(?:00|01|30|31)|(?:41|42)[0-9a-f]{2})$/iu;
const CAPABILITY_FIELDS = new Set([
  'model',
  'transport',
  'tcpPort',
  'encoding',
  'charactersPerLine',
  'asciiWidth',
  'cjkWidth',
  'feedLines',
  'supportsCut',
  'cutCommandHex',
  'connectionTimeoutMs',
  'writeTimeoutMs',
  'selfTestReference',
  'verifiedAt',
  'verificationStatus',
]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIntegerInRange = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is number =>
  Number.isInteger(value) &&
  Number(value) >= minimum &&
  Number(value) <= maximum;

const isPositiveInteger = (value: unknown): value is number =>
  isIntegerInRange(value, 1, 2_147_483_647);

const isIsoDateTime = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value));

const hasValidCutCapability = (
  supportsCut: unknown,
  cutCommandHex: unknown,
): boolean =>
  (supportsCut === false && cutCommandHex === null) ||
  (supportsCut === true &&
    typeof cutCommandHex === 'string' &&
    CUT_COMMAND_HEX.test(cutCommandHex));

export function parseVerifiedCapability(value: unknown): PocPrinterCapability {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((field) => CAPABILITY_FIELDS.has(field)) ||
    Object.keys(value).length !== CAPABILITY_FIELDS.size ||
    value.model !== 'XINYE_XP_58IIH' ||
    value.transport !== 'RAW_TCP' ||
    value.verificationStatus !== 'PASSED' ||
    !isIntegerInRange(value.tcpPort, 1, 65_535) ||
    (value.encoding !== 'GB18030' && value.encoding !== 'GBK') ||
    !isPositiveInteger(value.charactersPerLine) ||
    value.asciiWidth !== 1 ||
    value.cjkWidth !== 2 ||
    !isPositiveInteger(value.feedLines) ||
    !hasValidCutCapability(value.supportsCut, value.cutCommandHex) ||
    !isPositiveInteger(value.connectionTimeoutMs) ||
    !isPositiveInteger(value.writeTimeoutMs) ||
    typeof value.selfTestReference !== 'string' ||
    value.selfTestReference.trim().length === 0 ||
    !isIsoDateTime(value.verifiedAt)
  ) {
    throw new Error('Unverified printer capability');
  }

  return Object.freeze({ ...value }) as PocPrinterCapability;
}
