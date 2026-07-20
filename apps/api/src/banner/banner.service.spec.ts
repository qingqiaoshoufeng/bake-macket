import { BannerTargetType, type SaveBannerRequest } from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { Banner } from '../database/entities/banner.entity.js';
import { Category } from '../database/entities/category.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { BannerService } from './banner.service.js';

const createdAt = new Date('2026-07-18T08:00:00.000Z');
const updatedAt = new Date('2026-07-18T09:00:00.000Z');

const saveRequest = (
  overrides: Partial<SaveBannerRequest> = {},
): SaveBannerRequest =>
  ({
    image: {
      objectKey: 'banners/summer.webp',
      publicUrl: 'https://cdn.example.com/banners/summer.webp',
    },
    targetType: BannerTargetType.PRODUCT,
    targetId: 'product-1',
    sortOrder: 10,
    isActive: true,
    title: '夏日限定',
    ...overrides,
  }) as SaveBannerRequest;

const buildService = (
  banner: Record<string, unknown> | null = null,
  auditRecord = vi.fn().mockResolvedValue(undefined),
) => {
  const saved = vi.fn(async (entity: Record<string, unknown>) => ({
    id: 'banner-1',
    createdAt,
    updatedAt,
    ...entity,
  }));
  const bannerRepository = {
    find: vi.fn().mockResolvedValue(banner ? [banner] : []),
    findOneBy: vi.fn().mockResolvedValue(banner),
    create: vi.fn((value: Record<string, unknown>) => value),
    save: saved,
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const productRepository = {
    findOneBy: vi.fn().mockResolvedValue({
      id: 'product-1',
      categoryId: 'category-1',
      isActive: true,
    }),
  };
  const categoryRepository = {
    findOneBy: vi.fn().mockResolvedValue({
      id: 'category-1',
      isActive: true,
    }),
  };
  const repositories = new Map<unknown, object>([
    [Banner, bannerRepository],
    [Product, productRepository],
    [Category, categoryRepository],
  ]);
  const manager = {
    getRepository: vi.fn((entity: unknown) => repositories.get(entity)),
  };
  const rollback = vi.fn();
  const transaction = vi.fn(
    async (operation: (transactionManager: typeof manager) => unknown) => {
      try {
        return await operation(manager);
      } catch (error) {
        rollback();
        throw error;
      }
    },
  );
  const mediaPolicy = { assertBannerAsset: vi.fn() };
  const audit = { record: auditRecord };
  const service = new BannerService(
    bannerRepository as never,
    productRepository as never,
    categoryRepository as never,
    mediaPolicy as never,
    audit as never,
    { transaction } as never,
  );

  return {
    service,
    bannerRepository,
    mediaPolicy,
    audit,
    manager,
    transaction,
    rollback,
  };
};

const storedProductBanner = {
  id: 'banner-1',
  imageUrl: 'https://cdn.example.com/banners/summer.webp',
  imageObjectKey: 'banners/summer.webp',
  title: '夏日限定',
  targetType: BannerTargetType.PRODUCT,
  targetId: 'product-1',
  sortOrder: 10,
  isActive: true,
  createdAt,
  updatedAt,
};

describe('BannerService admin contract', () => {
  it('returns the shared AdminBannerView shape instead of a persistence entity', async () => {
    const { service } = buildService(storedProductBanner);

    await expect(service.list()).resolves.toEqual([
      {
        id: 'banner-1',
        image: {
          objectKey: 'banners/summer.webp',
          publicUrl: 'https://cdn.example.com/banners/summer.webp',
        },
        title: '夏日限定',
        targetType: BannerTargetType.PRODUCT,
        targetId: 'product-1',
        sortOrder: 10,
        isActive: true,
        createdAt: '2026-07-18T08:00:00.000Z',
        updatedAt: '2026-07-18T09:00:00.000Z',
      },
    ]);
  });

  it('keeps legacy rows manageable when object-key metadata is missing', async () => {
    const { service } = buildService({
      ...storedProductBanner,
      imageObjectKey: null,
    });

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'banner-1',
        image: null,
        targetType: BannerTargetType.PRODUCT,
      }),
    ]);
  });

  it('persists and audits the complete shared save request', async () => {
    const { service, bannerRepository, mediaPolicy, audit } = buildService();
    const request = saveRequest();

    await expect(service.create(request, 'admin-1')).resolves.toEqual(
      expect.objectContaining({
        image: request.image,
        targetType: BannerTargetType.PRODUCT,
        targetId: 'product-1',
      }),
    );
    expect(mediaPolicy.assertBannerAsset).toHaveBeenCalledWith(request.image);
    expect(bannerRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        imageObjectKey: 'banners/summer.webp',
        imageUrl: 'https://cdn.example.com/banners/summer.webp',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        targetEntity: 'banners',
        targetId: 'banner-1',
        action: 'BANNER_CREATED',
      }),
      expect.any(Object),
    );
  });

  it('clears a previous target and title when replacing a banner with NONE', async () => {
    const { service, bannerRepository, audit } = buildService({
      ...storedProductBanner,
    });
    const request: SaveBannerRequest = {
      image: saveRequest().image,
      targetType: BannerTargetType.NONE,
      sortOrder: 0,
      isActive: false,
    };

    const result = await service.update('banner-1', request, 'admin-1');

    expect(bannerRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: null,
        targetType: BannerTargetType.NONE,
        targetId: null,
      }),
    );
    expect(result).not.toHaveProperty('targetId');
    expect(result).not.toHaveProperty('title');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BANNER_UPDATED' }),
      expect.any(Object),
    );
  });

  it('audits deletion after confirming that the banner exists', async () => {
    const { service, audit, manager } = buildService(storedProductBanner);

    await service.remove('banner-1', 'admin-1');

    expect(audit.record).toHaveBeenCalledWith(
      {
        adminUserId: 'admin-1',
        targetEntity: 'banners',
        targetId: 'banner-1',
        action: 'BANNER_DELETED',
        changeSummary: expect.objectContaining({
          targetType: BannerTargetType.PRODUCT,
        }),
      },
      manager,
    );
  });

  it.each([
    {
      name: 'create',
      run: (service: BannerService) => service.create(saveRequest(), 'admin-1'),
    },
    {
      name: 'update',
      run: (service: BannerService) =>
        service.update('banner-1', saveRequest(), 'admin-1'),
    },
    {
      name: 'delete',
      run: (service: BannerService) => service.remove('banner-1', 'admin-1'),
    },
  ])('runs Banner $name and audit in one transaction', async ({ run }) => {
    const { service, transaction, manager, audit } =
      buildService(storedProductBanner);

    await run(service);

    expect(transaction).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(expect.any(Object), manager);
  });

  it.each([
    {
      name: 'create',
      run: (service: BannerService) => service.create(saveRequest(), 'admin-1'),
    },
    {
      name: 'update',
      run: (service: BannerService) =>
        service.update('banner-1', saveRequest(), 'admin-1'),
    },
    {
      name: 'delete',
      run: (service: BannerService) => service.remove('banner-1', 'admin-1'),
    },
  ])(
    'propagates audit failure from Banner $name so the transaction rolls back',
    async ({ run }) => {
      const auditFailure = new Error('audit failed');
      const { service, rollback } = buildService(
        storedProductBanner,
        vi.fn().mockRejectedValue(auditFailure),
      );

      await expect(run(service)).rejects.toBe(auditFailure);
      expect(rollback).toHaveBeenCalledOnce();
    },
  );
});
