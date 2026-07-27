import type { AdminProductSummaryView } from '@bake-mall/contracts';

import { productsApi } from '../api/index.js';
import { PRODUCT_PAGINATION } from '../config/pagination.js';

export async function loadAllProducts(): Promise<
  readonly AdminProductSummaryView[]
> {
  const first = await productsApi.list({
    page: PRODUCT_PAGINATION.defaultPage,
    pageSize: PRODUCT_PAGINATION.optionPageSize,
  });
  const pageCount = Math.ceil(first.total / first.pageSize);
  if (pageCount <= 1) return [...first.items];

  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      productsApi.list({
        page: index + 2,
        pageSize: first.pageSize,
      }),
    ),
  );
  return [first, ...rest].flatMap((result) => result.items);
}
