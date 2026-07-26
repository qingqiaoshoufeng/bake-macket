import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from '../../../config/pagination.js';

export const PRODUCT_PAGINATION = {
  defaultPage: 1,
  defaultPageSize: DEFAULT_PAGE_SIZE,
  pageSizes: PAGE_SIZE_OPTIONS,
  optionPageSize: 100,
} as const;
