/**
 * Money helpers shared across admin views.
 *
 * The backend persists integer cents (per the design spec §6), so the
 * admin SPA never works in floating-point yuan. The SKU editor converts
 * the free-form yuan string entered by the merchant into integer cents
 * via {@link yuanToCents}; rendering reverses it with
 * {@link formatCentsToYuan}.
 */

/**
 * Convert a yuan-denominated numeric string to integer cents, rounding
 * to the nearest cent. The brief pins the formula as
 * `Math.round(Number(yuan) * 100)`; non-numeric or negative inputs fall
 * back to 0 so the editor never propagates a `NaN` into the API.
 */
export function yuanToCents(yuan: string | number): number {
  const numeric = typeof yuan === 'number' ? yuan : Number(yuan);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric * 100);
}

export function formatCentsToYuan(cents: number): string {
  if (!Number.isFinite(cents)) return '0.00';
  return (cents / 100).toFixed(2);
}

/**
 * Format an integer-cent amount as Chinese-style "¥xx.xx". The currency
 * symbol precedes the number with no space so it matches the data column
 * layout in the H5 storefront.
 */
export function formatPriceCents(cents: number): string {
  return `¥${formatCentsToYuan(cents)}`;
}

const INT_UNSIGNED_MAX = 4_294_967_295;
const YUAN_TEXT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const DISCOUNT_TEXT_PATTERN = /^(?:[1-9](?:\.\d{1,3})?|10(?:\.0{1,3})?)$/;

/** Convert a merchant-entered yuan string to cents without floating point. */
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

export function centsToYuanText(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > INT_UNSIGNED_MAX) {
    throw new Error('分值超出允许范围');
  }
  const yuan = Math.floor(cents / 100);
  const decimal = String(cents % 100).padStart(2, '0');
  return `${yuan}.${decimal}`;
}

/** Convert 1.0–10.0 折 text to exact integer basis points. */
export function discountTextToBasisPoints(value: string): number {
  const normalized = value.trim();
  if (!DISCOUNT_TEXT_PATTERN.test(normalized)) {
    throw new Error('折扣必须为 1.0–10.0 折，最多保留三位小数');
  }
  const [wholeText, decimalText = ''] = normalized.split('.');
  const whole = Number.parseInt(wholeText, 10);
  const decimalThousandths = Number.parseInt(
    decimalText.padEnd(3, '0') || '0',
    10,
  );
  return whole * 1000 + decimalThousandths;
}

export function basisPointsToDiscountText(points: number): string {
  if (!Number.isInteger(points) || points < 1000 || points > 10000) {
    throw new Error('折扣基点超出允许范围');
  }
  const whole = Math.floor(points / 1000);
  const decimal = String(points % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${whole}.${decimal || '0'}`;
}
