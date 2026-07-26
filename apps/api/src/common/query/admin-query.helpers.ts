import type { PaginatedView } from '@bake-mall/contracts';

export const COMPLETE_DATETIME_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function toPaginatedView<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedView<T> {
  return { items, total, page, pageSize };
}
