import {
  BannerTargetType,
  BooleanFilter,
  type SaveBannerRequest,
} from '@bake-mall/contracts';
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
    createQueryBuilder: vi.fn(),
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
  it('filters target validity and stably paginates banners in the database', async () => {
    const builder = {
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[storedProductBanner], 4]),
    };
    const { service, bannerRepository } = buildService();
    bannerRepository.createQueryBuilder = vi.fn().mockReturnValue(builder);

    await expect(
      service.list({
        q: String.raw`  夏%_日\限定  `,
        isActive: BooleanFilter.YES,
        targetType: BannerTargetType.PRODUCT,
        targetId: 'product-1',
        targetValid: BooleanFilter.YES,
        createdAtFrom: '2026-07-01T00:00:00.000Z',
        createdAtBefore: '2026-08-01T00:00:00.000Z',
        page: 2,
        pageSize: 20,
      }),
    ).resolves.toEqual({
      items: [
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
      ],
      total: 4,
      page: 2,
      pageSize: 20,
    });
    expect(builder.andWhere.mock.calls).toEqual(
      expect.arrayContaining([
        [
          "banner.title LIKE :q ESCAPE '\\\\'",
          { q: String.raw`%夏\%\_日\\限定%` },
        ],
        ['banner.isActive = :isActive', { isActive: true }],
        [
          'banner.targetType = :targetType',
          { targetType: BannerTargetType.PRODUCT },
        ],
        ['banner.targetId = :targetId', { targetId: 'product-1' }],
        [expect.stringContaining('product_target.is_active = TRUE')],
        [
          'banner.createdAt >= :createdAtFrom',
          { createdAtFrom: new Date('2026-07-01T00:00:00.000Z') },
        ],
        [
          'banner.createdAt < :createdAtBefore',
          { createdAtBefore: new Date('2026-08-01T00:00:00.000Z') },
        ],
      ]),
    );
    expect(builder.orderBy).toHaveBeenCalledWith('banner.sortOrder', 'ASC');
    expect(builder.addOrderBy).toHaveBeenNthCalledWith(
      1,
      'banner.createdAt',
      'DESC',
    );
    expect(builder.addOrderBy).toHaveBeenNthCalledWith(2, 'banner.id', 'DESC');
    expect(builder.skip).toHaveBeenCalledWith(20);
  });

  it('filters invalid NONE targets and returns an empty page', async () => {
    const builder = {
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    };
    const { service, bannerRepository } = buildService();
    bannerRepository.createQueryBuilder = vi.fn().mockReturnValue(builder);

    await expect(
      service.list({
        targetType: BannerTargetType.NONE,
        targetValid: BooleanFilter.NO,
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(builder.andWhere.mock.calls).toEqual(
      expect.arrayContaining([
        [
          'banner.targetType = :targetType',
          { targetType: BannerTargetType.NONE },
        ],
        [expect.stringContaining('banner.target_id IS NULL')],
      ]),
    );
  });

  it('keeps legacy rows manageable when object-key metadata is missing', async () => {
    const builder = {
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi
        .fn()
        .mockResolvedValue([
          [{ ...storedProductBanner, imageObjectKey: null }],
          1,
        ]),
    };
    const { service, bannerRepository } = buildService();
    bannerRepository.createQueryBuilder = vi.fn().mockReturnValue(builder);

    await expect(service.list({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: 'banner-1',
          image: null,
          targetType: BannerTargetType.PRODUCT,
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
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
        actor: { type: 'ADMIN', adminUserId: 'admin-1' },
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
        actor: { type: 'ADMIN', adminUserId: 'admin-1' },
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
