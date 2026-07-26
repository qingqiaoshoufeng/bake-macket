export { formatMoney } from '../../../utils/money.js';

export function formatOrderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatSkuAttributes(
  attributes: Readonly<Record<string, string>>,
): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}:${value}`)
    .join(' / ');
}
