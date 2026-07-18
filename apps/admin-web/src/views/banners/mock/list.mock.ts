import { BannerTargetType, type AdminBannerView } from '@bake-mall/contracts';

export const bannerListMock: readonly AdminBannerView[] = [
  {
    id: 'banner-preview',
    image: {
      objectKey: 'banners/seasonal-preview.webp',
      publicUrl: '/fixtures/banner-placeholder.svg',
    },
    title: '今日新鲜出炉',
    targetType: BannerTargetType.NONE,
    sortOrder: 0,
    isActive: true,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  },
];
