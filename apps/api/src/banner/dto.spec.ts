import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { BannerTargetType } from '@bake-mall/contracts';

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
