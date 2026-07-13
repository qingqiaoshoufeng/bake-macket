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
