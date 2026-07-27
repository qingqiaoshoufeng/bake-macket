import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { BannerTargetType, BooleanFilter } from '@bake-mall/contracts';

import { AdminBannerListQueryDto } from './dto/admin-banner-list-query.dto.js';
import { SaveBannerDto } from './dto.js';

const validPayload = {
  image: {
    objectKey: 'banners/summer.webp',
    publicUrl: 'https://cdn.example.com/banners/summer.webp',
  },
  targetType: BannerTargetType.NONE,
  sortOrder: 0,
  isActive: true,
};

describe('AdminBannerListQueryDto', () => {
  it('defaults pagination and transforms a valid query', async () => {
    const dto = plainToInstance(AdminBannerListQueryDto, {
      q: '夏日',
      isActive: BooleanFilter.YES,
      targetType: BannerTargetType.PRODUCT,
      targetId: '1',
      targetValid: BooleanFilter.NO,
      createdAtFrom: '2026-07-01T00:00:00Z',
      pageSize: '50',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto).toMatchObject({ page: 1, pageSize: 50 });
  });

  it.each([
    { page: '0' },
    { pageSize: '101' },
    { isActive: 'MAYBE' },
    { targetType: 'URL' },
    { targetValid: 'MAYBE' },
    { createdAtFrom: '2026-07-01' },
    { createdAtBefore: 'not-a-date' },
  ])('rejects invalid query %#', async (invalid) => {
    const dto = plainToInstance(AdminBannerListQueryDto, invalid);
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('SaveBannerDto', () => {
  it.each(['create', 'update'])(
    'requires image in the shared %s payload',
    async () => {
      const errors = await validate(
        plainToInstance(SaveBannerDto, {
          targetType: validPayload.targetType,
          sortOrder: validPayload.sortOrder,
          isActive: validPayload.isActive,
        }),
      );

      expect(errors).toEqual([
        expect.objectContaining({
          property: 'image',
          constraints: expect.objectContaining({
            isDefined: expect.any(String),
          }),
        }),
      ]);
    },
  );
});
