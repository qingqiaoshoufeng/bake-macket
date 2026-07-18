import type { MediaAsset } from '@bake-mall/contracts';
import { BannerTargetType } from '@bake-mall/contracts';

export type BannerFormShape = {
  image: MediaAsset | null;
  title: string;
  targetType: BannerTargetType;
  targetId: string;
  sortOrder: number;
  isActive: boolean;
};

export type BannerTargetOption = {
  id: string;
  label: string;
};
