import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import {
  ApiErrorCode,
  BooleanFilter,
  ProductStockFilter,
  type SaveProductRequest,
} from '@bake-mall/contracts';

import { sanitizeProductHtml } from '../content/html-sanitizer.service.js';
import type { AppEnv } from '../config/env.schema.js';
import { Sku } from '../database/entities/sku.entity.js';
import { CatalogService } from './catalog.service.js';

type AggregateFixture = {
  product?: { id: string } | null;
  skus?: Array<{ id: string; productId: string; stockVersion: number }>;
  images?: Array<{ id: string; productId: string }>;
  conditionalAffected?: number;
};

const aggregateRequest = (
  overrides: Partial<SaveProductRequest> = {},
): SaveProductRequest => ({
  name: '草莓蛋糕',
  categoryId: 'category-1',
  detailHtml: '<p>detail</p>',
  coverImage: null,
  images: [],
  skus: [],
  deletedSkuIds: [],
  sortOrder: 0,
  isActive: false,
  ...overrides,
});

const buildAggregateService = ({
  product = null,
  skus = [],
  images = [],
  conditionalAffected = 1,
}: AggregateFixture = {}) => {
  const save = vi.fn(async (entity: unknown) => {
    const withDefaults = (value: object, index = 0) => ({
      id: String(index + 1),
      stockVersion: 1,
      createdAt: new Date('2026-07-16T00:00:00.000Z'),
      updatedAt: new Date('2026-07-16T00:00:00.000Z'),
      ...value,
    });
    return Array.isArray(entity)
      ? entity.map((value, index) => withDefaults(value as object, index))
      : withDefaults(entity as object);
  });
  const execute = vi.fn().mockResolvedValue({ affected: conditionalAffected });
  const queryBuilder = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute,
  };
  const categoryRepository = {
    findOneBy: vi.fn().mockResolvedValue({
      id: 'category-1',
      name: '蛋糕',
      isActive: true,
    }),
  };
  const productRepository = {
    findOneBy: vi.fn().mockResolvedValue(product),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(save),
  };
  const skuRepository = {
    find: vi.fn().mockResolvedValue(skus),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(save),
    delete: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn(() => queryBuilder),
  };
  const imageRepository = {
    find: vi.fn().mockResolvedValue(images),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(save),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const auditRepository = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(save),
  };
  const repositories = new Map<string, object>([
    ['Category', categoryRepository],
    ['Product', productRepository],
    ['Sku', skuRepository],
    ['ProductImage', imageRepository],
    ['AuditLog', auditRepository],
  ]);
  const manager = {
    getRepository: vi.fn((entity: { name: string }) =>
      repositories.get(entity.name),
    ),
  };
  const transaction = vi.fn(
    async (operation: (transactionManager: typeof manager) => unknown) =>
      operation(manager),
  );
  const assertProductAsset = vi.fn(
    (asset: { objectKey: string; publicUrl: string }) => {
      if (
        !asset.objectKey.startsWith('products/') ||
        !asset.publicUrl.startsWith('https://cdn.example.com/')
      ) {
        throw new UnprocessableEntityException({
          code: ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID,
          message: '商品媒体资产路径或来源无效',
        });
      }
    },
  );
  const service = new CatalogService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { sanitize: vi.fn((html: string) => html) } as never,
    { assertProductAsset } as never,
    { transaction } as never,
  );

  return {
    service,
    transaction,
    productRepository,
    skuRepository,
    imageRepository,
    auditRepository,
    queryBuilder,
    assertProductAsset,
  };
};

const sanitizerEnv = {
  NODE_ENV: 'production',
  OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/bake-mall',
  PRODUCT_MEDIA_ALLOWED_ORIGINS: ['https://cdn.example.com'],
} as AppEnv;

const buildListQueryBuilder = <T>(rows: T[], total = rows.length) => ({
  andWhere: vi.fn().mockReturnThis(),
  innerJoinAndSelect: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  addOrderBy: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  take: vi.fn().mockReturnThis(),
  getManyAndCount: vi.fn().mockResolvedValue([rows, total]),
});

describe('catalog admin lists', () => {
  it('filters and stably paginates categories in the database', async () => {
    const category = {
      id: 'category-1',
      name: '草莓蛋糕',
      imageUrl: 'https://cdn.example.com/categories/cake.webp',
      sortOrder: 2,
      isActive: true,
      createdAt: new Date('2026-07-20T08:00:00.000Z'),
      updatedAt: new Date('2026-07-21T08:00:00.000Z'),
    };
    const builder = buildListQueryBuilder([category], 3);
    const service = new CatalogService(
      { createQueryBuilder: vi.fn().mockReturnValue(builder) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.listAdminCategories({
        q: String.raw`  50%_off\today  `,
        isActive: BooleanFilter.YES,
        hasImage: BooleanFilter.YES,
        hasProducts: BooleanFilter.NO,
        createdAtFrom: '2026-07-01T00:00:00.000Z',
        createdAtBefore: '2026-08-01T00:00:00.000Z',
        page: 2,
        pageSize: 20,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'category-1',
          name: '草莓蛋糕',
          imageUrl: 'https://cdn.example.com/categories/cake.webp',
          sortOrder: 2,
          isActive: true,
          createdAt: '2026-07-20T08:00:00.000Z',
          updatedAt: '2026-07-21T08:00:00.000Z',
        },
      ],
      total: 3,
      page: 2,
      pageSize: 20,
    });
    expect(builder.andWhere.mock.calls).toEqual(
      expect.arrayContaining([
        [
          "category.name LIKE :q ESCAPE '\\\\'",
          { q: String.raw`%50\%\_off\\today%` },
        ],
        ['category.isActive = :isActive', { isActive: true }],
        ['category.imageUrl IS NOT NULL'],
        [expect.stringContaining('NOT EXISTS')],
        [
          'category.createdAt >= :createdAtFrom',
          { createdAtFrom: new Date('2026-07-01T00:00:00.000Z') },
        ],
        [
          'category.createdAt < :createdAtBefore',
          { createdAtBefore: new Date('2026-08-01T00:00:00.000Z') },
        ],
      ]),
    );
    expect(builder.orderBy).toHaveBeenCalledWith('category.sortOrder', 'ASC');
    expect(builder.addOrderBy).toHaveBeenNthCalledWith(
      1,
      'category.createdAt',
      'DESC',
    );
    expect(builder.addOrderBy).toHaveBeenNthCalledWith(
      2,
      'category.id',
      'DESC',
    );
    expect(builder.skip).toHaveBeenCalledWith(20);
    expect(builder.take).toHaveBeenCalledWith(20);
  });

  it('filters products by aggregate SKU state without per-product queries', async () => {
    const product = {
      id: 'product-1',
      categoryId: 'category-1',
      category: { id: 'category-1', name: '面包' },
      name: '售罄吐司',
      summary: null,
      coverImageUrl: null,
      coverImageObjectKey: null,
      sortOrder: 0,
      isActive: false,
      createdAt: new Date('2026-07-20T08:00:00.000Z'),
      updatedAt: new Date('2026-07-21T08:00:00.000Z'),
    };
    const builder = buildListQueryBuilder([product]);
    const skuRows = [{ productId: 'product-1', activeSkuCount: '0' }];
    const skuBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue(skuRows),
    };
    const skus = { createQueryBuilder: vi.fn().mockReturnValue(skuBuilder) };
    const service = new CatalogService(
      {} as never,
      { createQueryBuilder: vi.fn().mockReturnValue(builder) } as never,
      skus as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.listAdminProducts({
        q: '吐司',
        categoryId: 'category-1',
        isActive: BooleanFilter.NO,
        hasActiveSku: BooleanFilter.NO,
        stock: ProductStockFilter.OUT_OF_STOCK,
        lowStockThreshold: 10,
        hasCoverImage: BooleanFilter.NO,
        minPriceCents: 1000,
        maxPriceCents: 5000,
        createdAtFrom: '2026-07-01T00:00:00.000Z',
        createdAtBefore: '2026-08-01T00:00:00.000Z',
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ name: '售罄吐司', activeSkuCount: 0 })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(builder.andWhere.mock.calls).toEqual(
      expect.arrayContaining([
        [expect.stringContaining('NOT EXISTS')],
        [
          expect.stringContaining('COALESCE((SELECT MAX(sku_stock.stock)'),
          undefined,
        ],
        [
          expect.stringContaining('sku_price.price_cents >= :minPriceCents'),
          { minPriceCents: 1000, maxPriceCents: 5000 },
        ],
      ]),
    );
    expect(skus.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(skuBuilder.where).toHaveBeenCalledWith(
      'sku.productId IN (:...productIds)',
      {
        productIds: ['product-1'],
      },
    );
  });

  it('uses the default low-stock threshold with inclusive stock and price boundaries', async () => {
    const builder = buildListQueryBuilder([], 0);
    const service = new CatalogService(
      {} as never,
      { createQueryBuilder: vi.fn().mockReturnValue(builder) } as never,
      { createQueryBuilder: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.listAdminProducts({
      stock: ProductStockFilter.LOW_STOCK,
      minPriceCents: 0,
      maxPriceCents: 0,
      page: 1,
      pageSize: 20,
    });

    expect(builder.andWhere.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.stringContaining('COALESCE((SELECT MAX(sku_stock.stock)'),
          { lowStockThreshold: 10 },
        ],
        [
          expect.stringContaining('sku_price.price_cents >= :minPriceCents'),
          { minPriceCents: 0, maxPriceCents: 0 },
        ],
      ]),
    );
    expect(builder.getManyAndCount).toHaveBeenCalledOnce();
  });
});

describe('catalog safety', () => {
  it('removes scripts, event handlers, and unconfigured image URLs', () => {
    const html =
      '<p onclick="alert(1)">safe</p><script>alert(1)</script><img src="https://evil.test/a.png">';
    expect(sanitizeProductHtml(html, sanitizerEnv)).toBe('<p>safe</p>');
  });

  it('rejects a SKU with a negative stock or non-integer price', async () => {
    const service = new CatalogService(
      {} as never,
      {} as never,
      {
        findOne: vi.fn().mockResolvedValue({ id: '1' }),
        create: vi.fn(),
        save: vi.fn(),
      } as never,
      {} as never,
      { sanitize: vi.fn() } as never,
      { assertProductAsset: vi.fn() } as never,
    );

    await expect(
      service.createSku('1', { name: '6寸', priceCents: 68.5, stock: -1 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows saving an inactive draft without any SKU', async () => {
    const { service, transaction } = buildAggregateService();

    await expect(
      service.saveProductAggregate(null, aggregateRequest(), 'admin-1'),
    ).resolves.toEqual(expect.objectContaining({ isActive: false, skus: [] }));
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('rejects publishing an aggregate without an active SKU', async () => {
    const service = new CatalogService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { sanitize: vi.fn() } as never,
      { assertProductAsset: vi.fn() } as never,
    );
    const request: SaveProductRequest = {
      name: '草莓蛋糕',
      categoryId: 'category-1',
      detailHtml: '<p>detail</p>',
      coverImage: null,
      images: [],
      skus: [],
      deletedSkuIds: [],
      sortOrder: 0,
      isActive: true,
    };

    await expect(
      service.saveProductAggregate(null, request, 'admin-1'),
    ).rejects.toThrow('上架商品至少需要一个启用 SKU');
  });

  it.each([
    {
      name: 'SKU id from another product',
      productId: 'product-1',
      request: aggregateRequest({
        skus: [
          {
            id: 'sku-other',
            stockVersion: 1,
            name: '6寸',
            attributes: {},
            priceCents: 6800,
            stock: 3,
            isActive: true,
            image: null,
          },
        ],
      }),
    },
    {
      name: 'image id from another product',
      productId: 'product-1',
      request: aggregateRequest({
        images: [
          {
            id: 'image-other',
            objectKey: 'products/x.webp',
            publicUrl: 'https://cdn.example.com/products/x.webp',
            sortOrder: 0,
          },
        ],
      }),
    },
    {
      name: 'deleted SKU id from another product',
      productId: 'product-1',
      request: aggregateRequest({ deletedSkuIds: ['sku-other'] }),
    },
    {
      name: 'asset id on product creation',
      productId: null,
      request: aggregateRequest({
        images: [
          {
            id: 'image-other',
            objectKey: 'products/x.webp',
            publicUrl: 'https://cdn.example.com/products/x.webp',
            sortOrder: 0,
          },
        ],
      }),
    },
  ])('rejects $name with stable 422 error', async ({ productId, request }) => {
    const { service, auditRepository } = buildAggregateService({
      product: productId ? { id: productId } : null,
      skus: [
        { id: 'sku-own', productId: 'product-1', stockVersion: 1 },
        { id: 'sku-other', productId: 'product-2', stockVersion: 1 },
      ],
      images: [
        { id: 'image-own', productId: 'product-1' },
        { id: 'image-other', productId: 'product-2' },
      ],
    });

    await expect(
      service.saveProductAggregate(productId, request, 'admin-1'),
    ).rejects.toSatisfy(
      (error: { getResponse(): unknown; getStatus(): number }) => {
        expect(error.getStatus()).toBe(422);
        expect(error.getResponse()).toEqual({
          code: ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID,
          message: 'SKU 或商品图片不属于当前商品',
        });
        return true;
      },
    );
    expect(auditRepository.save).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'cover image object key',
      overrides: {
        coverImage: {
          objectKey: 'banners/cover.webp',
          publicUrl: 'https://cdn.example.com/products/cover.webp',
        },
      },
    },
    {
      name: 'carousel image public URL',
      overrides: {
        images: [
          {
            objectKey: 'products/detail.webp',
            publicUrl: 'https://evil.example/products/detail.webp',
            sortOrder: 0,
          },
        ],
      },
    },
    {
      name: 'SKU image public URL',
      overrides: {
        skus: [
          {
            name: '6寸',
            attributes: {},
            priceCents: 6800,
            stock: 3,
            isActive: true,
            image: {
              objectKey: 'products/sku.webp',
              publicUrl: 'https://evil.example/products/sku.webp',
            },
          },
        ],
      },
    },
  ])(
    'rejects invalid $name before opening the transaction',
    async ({ overrides }) => {
      const { service, transaction } = buildAggregateService();

      await expect(
        service.saveProductAggregate(
          null,
          aggregateRequest(overrides as Partial<SaveProductRequest>),
          'admin-1',
        ),
      ).rejects.toSatisfy(
        (error: { getResponse(): unknown; getStatus(): number }) => {
          expect(error.getStatus()).toBe(422);
          expect(error.getResponse()).toEqual({
            code: ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID,
            message: '商品媒体资产路径或来源无效',
          });
          return true;
        },
      );
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('rolls back with PRODUCT_STOCK_CONFLICT when stockVersion is stale', async () => {
    const {
      service,
      transaction,
      queryBuilder,
      skuRepository,
      auditRepository,
    } = buildAggregateService({
      product: { id: 'product-1' },
      skus: [{ id: 'sku-1', productId: 'product-1', stockVersion: 5 }],
      conditionalAffected: 0,
    });
    const request = aggregateRequest({
      skus: [
        {
          id: 'sku-1',
          stockVersion: 4,
          name: '6寸',
          attributes: {},
          priceCents: 6800,
          stock: 3,
          isActive: true,
          image: null,
        },
      ],
    });

    await expect(
      service.saveProductAggregate('product-1', request, 'admin-1'),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual({
        code: ApiErrorCode.PRODUCT_STOCK_CONFLICT,
        message: '库存已发生变化，请重新加载后再保存',
        details: { skuId: 'sku-1' },
      });
      return true;
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(skuRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ stockVersion: expect.any(Function) }),
    );
    const setValues = queryBuilder.set.mock.calls[0]?.[0] as {
      stockVersion: () => string;
    };
    expect(setValues.stockVersion()).toBe('stock_version + 1');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'id = :id AND product_id = :productId AND stock_version = :stockVersion',
      { id: 'sku-1', productId: 'product-1', stockVersion: 4 },
    );
    expect(auditRepository.save).not.toHaveBeenCalled();
  });

  it('returns the incremented stockVersion after a successful aggregate save', async () => {
    const { service, queryBuilder } = buildAggregateService({
      product: { id: 'product-1' },
      skus: [{ id: 'sku-1', productId: 'product-1', stockVersion: 4 }],
    });
    const request = aggregateRequest({
      skus: [
        {
          id: 'sku-1',
          stockVersion: 4,
          name: '6寸',
          attributes: { size: '6寸' },
          priceCents: 6800,
          stock: 3,
          isActive: true,
          image: null,
        },
      ],
    });

    const result = await service.saveProductAggregate(
      'product-1',
      request,
      'admin-1',
    );

    expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
    expect(result.skus).toEqual([
      expect.objectContaining({ id: 'sku-1', stockVersion: 5, stock: 3 }),
    ]);
  });

  it('sanitizes historical HTML before returning aggregate and admin details', async () => {
    const dirtyHtml = '<p onclick="alert(1)">safe</p><script>alert(1)</script>';
    const sanitizedHtml = '<p>safe</p>';
    const product = {
      id: 'product-1',
      detailHtml: dirtyHtml,
      category: { id: 'category-1', name: '蛋糕', isActive: true },
      categoryId: 'category-1',
      name: '草莓蛋糕',
      summary: null,
      coverImageUrl: null,
      coverImageObjectKey: null,
      sortOrder: 0,
      isActive: true,
      createdAt: new Date('2026-07-16T00:00:00.000Z'),
      updatedAt: new Date('2026-07-16T00:00:00.000Z'),
    };
    const sanitizer = { sanitize: vi.fn().mockReturnValue(sanitizedHtml) };
    const service = new CatalogService(
      {} as never,
      {
        findOne: vi.fn().mockResolvedValue(product),
      } as never,
      { find: vi.fn().mockResolvedValue([]) } as never,
      { find: vi.fn().mockResolvedValue([]) } as never,
      sanitizer as never,
      {} as never,
    );

    const detail = await service.getAdminProduct('product-1');

    expect(detail.detailHtml).toBe(sanitizedHtml);
    expect(sanitizer.sanitize).toHaveBeenCalledWith(dirtyHtml);
    expect(product.detailHtml).toBe(dirtyHtml);
  });

  it('uses the VersionColumn repository save path for legacy SKU updates', async () => {
    const sku = {
      id: 'sku-1',
      productId: 'product-1',
      name: '6寸',
      attributes: {},
      priceCents: 6800,
      stock: 2,
      imageUrl: null,
      isActive: true,
      stockVersion: 5,
    };
    const save = vi.fn().mockResolvedValue(sku);
    const service = new CatalogService(
      {} as never,
      {} as never,
      {
        findOneBy: vi.fn().mockResolvedValue(sku),
        save,
      } as never,
      {} as never,
      { sanitize: vi.fn() } as never,
      { assertProductAsset: vi.fn() } as never,
    );

    await service.updateSku('product-1', 'sku-1', { stock: 3 });

    const stockVersionColumn = getMetadataArgsStorage().columns.find(
      ({ target, propertyName }) =>
        target === Sku && propertyName === 'stockVersion',
    );
    expect(stockVersionColumn?.mode).toBe('version');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ stock: 3 }));
  });

  it('saves product, SKUs, images, and audit within one transaction', async () => {
    const save = vi.fn(async (entity: unknown) =>
      Array.isArray(entity)
        ? entity.map((value, index) => ({ id: String(index + 1), ...value }))
        : {
            id: 'product-1',
            createdAt: new Date('2026-07-16T00:00:00.000Z'),
            updatedAt: new Date('2026-07-16T00:00:00.000Z'),
            ...(entity as object),
          },
    );
    const deleteRows = vi.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: vi.fn((entity: { name: string }) => ({
        findOneBy: vi
          .fn()
          .mockResolvedValue(
            entity.name === 'Category' ? { id: 'category-1' } : null,
          ),
        create: vi.fn((value: unknown) => value),
        save,
        delete: deleteRows,
      })),
    };
    const transaction = vi.fn(
      async (operation: (transactionManager: unknown) => unknown) =>
        operation(manager),
    );
    const service = new CatalogService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { sanitize: vi.fn().mockReturnValue('<p>clean</p>') } as never,
      { assertProductAsset: vi.fn() } as never,
      { transaction } as never,
    );
    const request: SaveProductRequest = {
      name: '草莓蛋糕',
      categoryId: 'category-1',
      detailHtml: '<script>x</script><p>clean</p>',
      coverImage: {
        objectKey: 'products/cover.webp',
        publicUrl: 'https://cdn.example.com/products/cover.webp',
      },
      images: [
        {
          objectKey: 'products/detail.webp',
          publicUrl: 'https://cdn.example.com/products/detail.webp',
          sortOrder: 0,
        },
      ],
      skus: [
        {
          name: '6寸',
          attributes: { size: '6寸' },
          priceCents: 6800,
          stock: 0,
          isActive: true,
          image: null,
        },
      ],
      deletedSkuIds: [],
      sortOrder: 0,
      isActive: true,
    };

    await service.saveProductAggregate(null, request, 'admin-1');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalled();
  });
});
