import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { BooleanFilter, ProductStockFilter } from '@bake-mall/contracts';

import { AdminCategoryListQueryDto } from './admin-category-list-query.dto.js';
import { AdminProductListQueryDto } from './admin-product-list-query.dto.js';

describe('AdminCategoryListQueryDto', () => {
  it('defaults pagination and accepts all supported filters', async () => {
    const dto = plainToInstance(AdminCategoryListQueryDto, {
      q: '蛋糕',
      isActive: BooleanFilter.YES,
      hasImage: BooleanFilter.NO,
      hasProducts: BooleanFilter.YES,
      createdAtFrom: '2026-07-01T00:00:00Z',
      createdAtBefore: '2026-08-01T00:00:00+08:00',
      pageSize: '50',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto).toMatchObject({ page: 1, pageSize: 50 });
  });

  it.each([
    { page: '0' },
    { pageSize: '101' },
    { isActive: 'MAYBE' },
    { hasImage: 'MAYBE' },
    { createdAtFrom: '2026-07-01' },
  ])('rejects invalid category query %#', async (invalid) => {
    expect(
      await validate(plainToInstance(AdminCategoryListQueryDto, invalid)),
    ).not.toHaveLength(0);
  });
});

describe('AdminProductListQueryDto', () => {
  it('transforms integer filters and accepts aggregate filters', async () => {
    const dto = plainToInstance(AdminProductListQueryDto, {
      categoryId: '1',
      isActive: BooleanFilter.NO,
      hasActiveSku: BooleanFilter.YES,
      stock: ProductStockFilter.LOW_STOCK,
      lowStockThreshold: '10',
      hasCoverImage: BooleanFilter.NO,
      minPriceCents: '1000',
      maxPriceCents: '5000',
      page: '2',
      pageSize: '20',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto).toMatchObject({
      lowStockThreshold: 10,
      minPriceCents: 1000,
      maxPriceCents: 5000,
      page: 2,
      pageSize: 20,
    });
  });

  it.each([
    { stock: 'SOME_STOCK' },
    { lowStockThreshold: '-1' },
    { lowStockThreshold: '1.5' },
    { minPriceCents: '-1' },
    { maxPriceCents: '1.5' },
    { createdAtBefore: '2026-08-01' },
  ])('rejects invalid product query %#', async (invalid) => {
    expect(
      await validate(plainToInstance(AdminProductListQueryDto, invalid)),
    ).not.toHaveLength(0);
  });
});
