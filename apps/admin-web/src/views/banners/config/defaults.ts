import { BannerTargetType } from '@bake-mall/contracts';

import type { BannerFormShape } from '../type/form.js';

export const createBannerDefaults = (): BannerFormShape => ({
  image: null,
  title: '',
  targetType: BannerTargetType.NONE,
  targetId: '',
  sortOrder: 0,
  isActive: true,
});
