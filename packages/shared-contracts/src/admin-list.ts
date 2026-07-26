export enum BooleanFilter {
  YES = 'YES',
  NO = 'NO',
}

export enum ProductStockFilter {
  IN_STOCK = 'IN_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

export type AdminPageQuery = {
  page: number;
  pageSize: number;
};

export type CreatedAtRangeQuery = {
  createdAtFrom?: string;
  createdAtBefore?: string;
};

export type UpdatedAtRangeQuery = {
  updatedAtFrom?: string;
  updatedAtBefore?: string;
};

export type PaginatedView<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
