import { BooleanFilter } from '@bake-mall/contracts';

export type CategoryFilterForm = {
  q: string;
  isActive: '' | BooleanFilter;
  hasImage: '' | BooleanFilter;
  hasProducts: '' | BooleanFilter;
  createdAtRange: readonly [string, string] | null;
};
