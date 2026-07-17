import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@bake-mall/contracts';

import type { AppConfig, AppEnv } from '../config/env.schema.js';
import { envSchema } from '../config/env.schema.js';
import {
  isAllowedProductPublicUrl,
  MediaAssetPolicyService,
} from './media-asset-policy.service.js';

const buildPolicy = (env: AppEnv): MediaAssetPolicyService =>
  new MediaAssetPolicyService({
    get: () => env,
  } as unknown as ConfigService<AppConfig, true>);

const productionEnv = {
  NODE_ENV: 'production',
  OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://cos.example.com/bake-mall',
  PRODUCT_MEDIA_ALLOWED_ORIGINS: ['https://cdn.example.com'],
} as AppEnv;

describe('MediaAssetPolicyService', () => {
  it('accepts a product asset served by a configured CDN', () => {
    const service = buildPolicy(productionEnv);

    expect(() =>
      service.assertProductAsset({
        objectKey: 'products/cover.webp',
        publicUrl: 'https://cdn.example.com/products/cover.webp',
      }),
    ).not.toThrow();
  });

  it('rejects an object key outside the products prefix', () => {
    const service = buildPolicy(productionEnv);

    expect(() =>
      service.assertProductAsset({
        objectKey: 'banners/x.webp',
        publicUrl: 'https://cdn.example.com/banners/x.webp',
      }),
    ).toThrowError(
      expect.objectContaining({
        response: {
          code: ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID,
          message: '商品媒体资产路径或来源无效',
        },
        status: 422,
      }),
    );
  });

  it('rejects an unconfigured or lookalike host', () => {
    expect(
      isAllowedProductPublicUrl(
        'https://cdn.example.com.evil.test/products/x.webp',
        productionEnv,
      ),
    ).toBe(false);
  });

  it('automatically allows the configured object storage base origin', () => {
    expect(
      isAllowedProductPublicUrl(
        'https://cos.example.com/bake-mall/products/x.webp',
        productionEnv,
      ),
    ).toBe(true);
    expect(
      isAllowedProductPublicUrl(
        'http://127.0.0.1:9000/bake-mall/products/x.webp',
        {
          ...productionEnv,
          NODE_ENV: 'development',
          OBJECT_STORAGE_PUBLIC_BASE_URL: 'http://127.0.0.1:9000/bake-mall',
          PRODUCT_MEDIA_ALLOWED_ORIGINS: [],
        },
      ),
    ).toBe(true);
  });

  it('only allows explicitly configured 127.0.0.1 HTTP origins outside production', () => {
    const developmentEnv = {
      ...productionEnv,
      NODE_ENV: 'development',
      PRODUCT_MEDIA_ALLOWED_ORIGINS: [
        'http://127.0.0.1:9000',
        'http://localhost:9000',
      ],
    } as AppEnv;

    expect(
      isAllowedProductPublicUrl(
        'http://127.0.0.1:9000/bake-mall/products/x.webp',
        developmentEnv,
      ),
    ).toBe(true);
    expect(
      isAllowedProductPublicUrl(
        'http://localhost:9000/bake-mall/products/x.webp',
        developmentEnv,
      ),
    ).toBe(false);
  });

  it('normalizes a comma-separated origin allowlist', () => {
    const { value, error } = envSchema.validate({
      MYSQL_HOST: '127.0.0.1',
      PRODUCT_MEDIA_ALLOWED_ORIGINS:
        ' https://cdn.example.com, ,http://127.0.0.1:9000 ',
    });

    expect(error).toBeUndefined();
    expect(value.PRODUCT_MEDIA_ALLOWED_ORIGINS).toEqual([
      'https://cdn.example.com',
      'http://127.0.0.1:9000',
    ]);
  });
});
