const INT_UNSIGNED_MAX = 4_294_967_295;
const YUAN_TEXT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

/** Convert a customer-entered yuan string to integer cents without floating point. */
export function yuanTextToCents(value: string): number {
  const normalized = value.trim();
  const match = YUAN_TEXT_PATTERN.exec(normalized);
  if (!match) throw new Error('金额最多保留两位小数');

  const yuan = Number.parseInt(match[1], 10);
  const decimal = Number.parseInt((match[2] ?? '').padEnd(2, '0') || '0', 10);
  const cents = yuan * 100 + decimal;
  if (!Number.isSafeInteger(cents) || cents > INT_UNSIGNED_MAX) {
    throw new Error('金额超出允许范围');
  }
  return cents;
}

export function formatMoney(cents: number): string {
  const yuan = Math.floor(cents / 100);
  const decimal = String(cents % 100).padStart(2, '0');
  return `¥${yuan}.${decimal}`;
}
