import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@bake-mall/contracts';

import type { AppConfig, AppEnv } from '../config/env.schema.js';
import { envSchema } from '../config/env.schema.js';
import {
  isAllowedProductAssetUrl,
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

  it('accepts only an exact banners asset for Banner persistence', () => {
    const service = buildPolicy(productionEnv);

    expect(() =>
      service.assertBannerAsset({
        objectKey: 'banners/summer.webp',
        publicUrl: 'https://cdn.example.com/banners/summer.webp',
      }),
    ).not.toThrow();
    expect(() =>
      service.assertBannerAsset({
        objectKey: 'products/cover.webp',
        publicUrl: 'https://cdn.example.com/products/cover.webp',
      }),
    ).toThrowError(
      expect.objectContaining({
        response: {
          code: ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID,
          message: 'Banner 媒体资产路径或来源无效',
        },
        status: 422,
      }),
    );
  });

  it('rejects a Banner object key paired with a different public URL', () => {
    const service = buildPolicy(productionEnv);

    expect(() =>
      service.assertBannerAsset({
        objectKey: 'banners/summer.webp',
        publicUrl: 'https://cdn.example.com/banners/other.webp',
      }),
    ).toThrowError(expect.objectContaining({ status: 422 }));
  });

  it('rejects a product object key paired with a different media namespace', () => {
    const service = buildPolicy(productionEnv);

    expect(() =>
      service.assertProductAsset({
        objectKey: 'products/cover.webp',
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

  it('rejects a public URL whose product path differs from its object key', () => {
    const service = buildPolicy(productionEnv);

    expect(() =>
      service.assertProductAsset({
        objectKey: 'products/cover.webp',
        publicUrl: 'https://cdn.example.com/products/other.webp',
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

  it.each([
    'https://cdn.example.com/products/ignored/../cover.webp',
    'https://cdn.example.com/products/ignored/%2e%2e/cover.webp',
    'https://cdn.example.com/products/ignored/%2E%2E/cover.webp',
    'https://cdn.example.com/products/ignored\\..\\cover.webp',
    'https://user:pass@cdn.example.com/products/cover.webp',
    'https://@cdn.example.com/products/cover.webp',
    'https://:@cdn.example.com/products/cover.webp',
  ])('rejects an ambiguous raw asset URL: %s', (publicUrl) => {
    const service = buildPolicy(productionEnv);

    expect(() =>
      service.assertProductAsset({
        objectKey: 'products/cover.webp',
        publicUrl,
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

  it('does not mistake an at sign outside the authority for userinfo', () => {
    const service = buildPolicy(productionEnv);

    expect(() =>
      service.assertProductAsset({
        objectKey: 'products/cover@2x.webp',
        publicUrl: 'https://cdn.example.com/products/cover@2x.webp',
      }),
    ).not.toThrow();
    expect(
      isAllowedProductPublicUrl(
        'https://cdn.example.com/products/cover.webp?owner=@merchant',
        productionEnv,
      ),
    ).toBe(true);
  });

  it('accepts a URL issued from an object storage base with multiple trailing slashes', () => {
    const envWithTrailingSlashes = {
      ...productionEnv,
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://cos.example.com/bake-mall///',
    } as AppEnv;

    expect(
      isAllowedProductAssetUrl(
        'https://cos.example.com/bake-mall/products/cover.webp',
        'products/cover.webp',
        envWithTrailingSlashes,
      ),
    ).toBe(true);
  });

  it('maps the object storage pathname base to the exact object key', () => {
    expect(
      isAllowedProductAssetUrl(
        'https://cos.example.com/bake-mall/products/cover.webp',
        'products/cover.webp',
        productionEnv,
      ),
    ).toBe(true);
    expect(
      isAllowedProductAssetUrl(
        'https://cos.example.com/products/cover.webp',
        'products/cover.webp',
        productionEnv,
      ),
    ).toBe(false);
    expect(
      isAllowedProductAssetUrl(
        'https://cos.example.com/bake-mall-evil/products/cover.webp',
        'products/cover.webp',
        productionEnv,
      ),
    ).toBe(false);
  });

  it('maps configured CDN pathname bases to the exact object key', () => {
    expect(
      isAllowedProductAssetUrl(
        'https://cdn.example.com/products/cover.webp',
        'products/cover.webp',
        productionEnv,
      ),
    ).toBe(true);

    const pathnameBaseEnv = {
      ...productionEnv,
      PRODUCT_MEDIA_ALLOWED_ORIGINS: ['https://cdn.example.com/media'],
    } as AppEnv;
    expect(
      isAllowedProductAssetUrl(
        'https://cdn.example.com/media/products/cover.webp',
        'products/cover.webp',
        pathnameBaseEnv,
      ),
    ).toBe(true);
    expect(
      isAllowedProductAssetUrl(
        'https://cdn.example.com/products/cover.webp',
        'products/cover.webp',
        pathnameBaseEnv,
      ),
    ).toBe(false);
  });

  it('rejects ambiguous or encoded asset URL identities', () => {
    expect(
      isAllowedProductAssetUrl(
        'https://cdn.example.com/products/cover.webp?version=2',
        'products/cover.webp',
        productionEnv,
      ),
    ).toBe(false);
    expect(
      isAllowedProductAssetUrl(
        'https://cdn.example.com/products/cover.webp#preview',
        'products/cover.webp',
        productionEnv,
      ),
    ).toBe(false);
    expect(
      isAllowedProductAssetUrl(
        'https://cdn.example.com/products%2Fcover.webp',
        'products/cover.webp',
        productionEnv,
      ),
    ).toBe(false);
    expect(
      isAllowedProductAssetUrl(
        'https://cdn.example.com//products/cover.webp',
        'products/cover.webp',
        productionEnv,
      ),
    ).toBe(false);
    expect(
      isAllowedProductAssetUrl(
        'https://cdn.example.com/products/%252e%252e/banners/x.webp',
        'products/%252e%252e/banners/x.webp',
        productionEnv,
      ),
    ).toBe(false);
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
