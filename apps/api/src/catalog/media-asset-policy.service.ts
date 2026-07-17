import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiErrorCode, type MediaAsset } from '@bake-mall/contracts';

import type { AppConfig, AppEnv } from '../config/env.schema.js';

export type ProductMediaEnv = Pick<
  AppEnv,
  | 'NODE_ENV'
  | 'OBJECT_STORAGE_PUBLIC_BASE_URL'
  | 'PRODUCT_MEDIA_ALLOWED_ORIGINS'
>;

const parseUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};

const toOrigin = (rawUrl: string): string | null =>
  parseUrl(rawUrl)?.origin ?? null;

const isExplicitLocalHttpOrigin = (
  url: URL,
  configuredOrigins: ReadonlySet<string>,
): boolean =>
  url.protocol === 'http:' &&
  url.hostname === '127.0.0.1' &&
  configuredOrigins.has(url.origin);

export function isAllowedProductPublicUrl(
  rawUrl: string,
  env: ProductMediaEnv,
): boolean {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  const configuredOrigins = new Set(
    env.PRODUCT_MEDIA_ALLOWED_ORIGINS.map(toOrigin).filter(
      (origin): origin is string => origin !== null,
    ),
  );
  const baseOrigin = toOrigin(env.OBJECT_STORAGE_PUBLIC_BASE_URL);
  const allowedOrigins = new Set(
    baseOrigin ? [...configuredOrigins, baseOrigin] : configuredOrigins,
  );
  if (!allowedOrigins.has(url.origin)) return false;

  if (env.NODE_ENV === 'production') return url.protocol === 'https:';
  return (
    url.protocol === 'https:' || isExplicitLocalHttpOrigin(url, allowedOrigins)
  );
}

@Injectable()
export class MediaAssetPolicyService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  assertProductAsset(asset: MediaAsset): void {
    const env = this.config.get('appEnv', { infer: true });
    const isValid =
      asset.objectKey.startsWith('products/') &&
      isAllowedProductPublicUrl(asset.publicUrl, env);
    if (isValid) return;

    throw new UnprocessableEntityException({
      code: ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID,
      message: '商品媒体资产路径或来源无效',
    });
  }
}
