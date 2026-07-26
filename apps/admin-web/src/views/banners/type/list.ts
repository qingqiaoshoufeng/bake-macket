import { BannerTargetType, BooleanFilter } from '@bake-mall/contracts';

export type BannerFilterForm = {
  q: string;
  isActive: '' | BooleanFilter;
  targetType: '' | BannerTargetType;
  targetId: string;
  targetValid: '' | BooleanFilter;
  createdAtRange: readonly [string, string] | null;
};
