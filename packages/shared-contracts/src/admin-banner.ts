import { BannerTargetType } from './enums.js';
import type { MediaAsset } from './media.js';

export type SaveBannerCommon = {
  image: MediaAsset;
  title?: string;
  sortOrder: number;
  isActive: boolean;
};

export type SaveBannerRequest = SaveBannerCommon &
  (
    | {
        targetType: BannerTargetType.NONE;
        targetId?: never;
      }
    | {
        targetType: BannerTargetType.PRODUCT;
        targetId: string;
      }
    | {
        targetType: BannerTargetType.CATEGORY;
        targetId: string;
      }
  );

export type AdminBannerView = SaveBannerRequest & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
