import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { sanitizeProductHtml } from '../content/html-sanitizer.service.js';
import type { SaveProductRequest } from '@bake-mall/contracts';

import { CatalogService } from './catalog.service.js';

describe('catalog safety', () => {
  it('removes scripts, event handlers, and non-COS image URLs', () => {
    const html =
      '<p onclick="alert(1)">safe</p><script>alert(1)</script><img src="https://evil.test/a.png">';
    expect(sanitizeProductHtml(html)).toBe('<p>safe</p>');
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
    );

    await expect(
      service.createSku('1', { name: '6寸', priceCents: 68.5, stock: -1 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects publishing an aggregate without an active SKU', async () => {
    const service = new CatalogService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { sanitize: vi.fn() } as never,
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

  it('saves product, SKUs, images, and audit within one transaction', async () => {
    const save = vi.fn(async (entity: unknown) =>
      Array.isArray(entity)
        ? entity.map((value, index) => ({ id: String(index + 1), ...value }))
        : {
            id: 'product-1',
            createdAt: new Date('2026-07-16T00:00:00.000Z'),
            updatedAt: new Date('2026-07-16T00:00:00.000Z'),
            ...entity as object,
          },
    );
    const deleteRows = vi.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: vi.fn((entity: { name: string }) => ({
        findOneBy: vi.fn().mockResolvedValue(entity.name === 'Category' ? { id: 'category-1' } : null),
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
