const isEmptyValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

export function compactQuery<T extends Record<string, unknown>>(
  query: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => !isEmptyValue(value)),
  ) as Partial<T>;
}

export function toExclusiveDateRange(range: readonly [string, string] | null): {
  from?: string;
  before?: string;
} {
  return range ? { from: range[0], before: range[1] } : {};
}

export function countActiveFilters(value: Record<string, unknown>): number {
  return Object.values(value).filter((item) => !isEmptyValue(item)).length;
}
