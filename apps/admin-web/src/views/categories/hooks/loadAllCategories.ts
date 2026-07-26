import type { AdminCategoryView } from '@bake-mall/contracts';

import { categoriesApi } from '../api/index.js';
import { CATEGORY_PAGINATION } from '../config/pagination.js';

export async function loadAllCategories(): Promise<
  readonly AdminCategoryView[]
> {
  const first = await categoriesApi.list({
    page: CATEGORY_PAGINATION.defaultPage,
    pageSize: CATEGORY_PAGINATION.optionPageSize,
  });
  const pageCount = Math.ceil(first.total / first.pageSize);
  if (pageCount <= 1) return [...first.items];

  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      categoriesApi.list({
        page: index + 2,
        pageSize: first.pageSize,
      }),
    ),
  );
  return [first, ...rest].flatMap((result) => result.items);
}
