import { BannerTargetType } from '@bake-mall/contracts';

import type { BannerFormShape } from '../type/form.js';
import type { BannerFilterForm } from '../type/list.js';

export const createBannerFilterDefaults = (): BannerFilterForm => ({
  q: '',
  isActive: '',
  targetType: '',
  targetId: '',
  targetValid: '',
  createdAtRange: null,
});

export const createBannerDefaults = (): BannerFormShape => ({
  image: null,
  title: '',
  targetType: BannerTargetType.NONE,
  targetId: '',
  sortOrder: 0,
  isActive: true,
});
