import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiErrorCode, type MediaAsset } from '@bake-mall/contracts';

import type { AppConfig, AppEnv } from '../config/env.schema.js';
import { joinMediaUrl, normalizeMediaBaseUrl } from '../media-url.js';

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

const hasUnambiguousObjectKeyPath = (objectKey: string): boolean =>
  !objectKey.includes('\\') &&
  !objectKey.includes('%') &&
  objectKey
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');

const getAuthorityBounds = (
  rawUrl: string,
): readonly [number, number] | null => {
  const authorityMarkerIndex = rawUrl.indexOf('//');
  if (authorityMarkerIndex === -1) return null;

  const authorityStart = authorityMarkerIndex + 2;
  const delimiterIndexes = ['/', '?', '#']
    .map((delimiter) => rawUrl.indexOf(delimiter, authorityStart))
    .filter((index) => index !== -1);
  const authorityEnd =
    delimiterIndexes.length === 0
      ? rawUrl.length
      : Math.min(...delimiterIndexes);
  return [authorityStart, authorityEnd];
};

const getRawAuthority = (rawUrl: string): string | null => {
  const bounds = getAuthorityBounds(rawUrl);
  return bounds ? rawUrl.slice(...bounds) : null;
};

const getRawPathname = (rawUrl: string): string | null => {
  const bounds = getAuthorityBounds(rawUrl);
  if (!bounds) return null;

  const pathnameStart = bounds[1];
  if (rawUrl[pathnameStart] !== '/') return null;

  const suffixIndexes = [
    rawUrl.indexOf('?', pathnameStart),
    rawUrl.indexOf('#', pathnameStart),
  ].filter((index) => index !== -1);
  const pathnameEnd =
    suffixIndexes.length === 0 ? rawUrl.length : Math.min(...suffixIndexes);
  return rawUrl.slice(pathnameStart, pathnameEnd);
};

const isDotPathSegment = (segment: string): boolean => {
  try {
    const decodedSegment = decodeURIComponent(segment);
    return decodedSegment === '.' || decodedSegment === '..';
  } catch {
    return true;
  }
};

const hasUnambiguousRawAssetUrl = (rawUrl: string, url: URL): boolean => {
  const rawAuthority = getRawAuthority(rawUrl);
  if (
    rawUrl.includes('\\') ||
    rawAuthority?.includes('@') ||
    url.username ||
    url.password
  ) {
    return false;
  }

  const rawPathname = getRawPathname(rawUrl);
  if (!rawPathname?.startsWith('/')) return false;

  return rawPathname
    .slice(1)
    .split('/')
    .every((segment) => segment !== '' && !isDotPathSegment(segment));
};

const isExplicitLocalHttpOrigin = (
  url: URL,
  configuredOrigins: ReadonlySet<string>,
): boolean =>
  url.protocol === 'http:' &&
  url.hostname === '127.0.0.1' &&
  configuredOrigins.has(url.origin);

const getProductMediaBases = (env: ProductMediaEnv): URL[] =>
  [env.OBJECT_STORAGE_PUBLIC_BASE_URL, ...env.PRODUCT_MEDIA_ALLOWED_ORIGINS]
    .map(normalizeMediaBaseUrl)
    .map(parseUrl)
    .filter((base): base is URL => base !== null);

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

export function isAllowedProductAssetUrl(
  rawUrl: string,
  objectKey: string,
  env: ProductMediaEnv,
): boolean {
  if (
    !hasUnambiguousObjectKeyPath(objectKey) ||
    !isAllowedProductPublicUrl(rawUrl, env)
  ) {
    return false;
  }

  const url = parseUrl(rawUrl);
  if (
    !url ||
    url.search ||
    url.hash ||
    !hasUnambiguousRawAssetUrl(rawUrl, url)
  ) {
    return false;
  }

  return getProductMediaBases(env).some(
    (base) =>
      base.origin === url.origin &&
      url.pathname === joinMediaUrl(base.pathname, objectKey),
  );
}

@Injectable()
export class MediaAssetPolicyService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  assertProductAsset(asset: MediaAsset): void {
    this.assertAsset(
      asset,
      'products/',
      '商品媒体资产路径或来源无效',
      ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID,
    );
  }

  assertBannerAsset(asset: MediaAsset): void {
    this.assertAsset(
      asset,
      'banners/',
      'Banner 媒体资产路径或来源无效',
      ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID,
    );
  }

  assertHomepageAsset(asset: MediaAsset): void {
    this.assertAsset(
      asset,
      'homepage/',
      '首页媒体资产路径或来源无效',
      ApiErrorCode.HOMEPAGE_ASSET_OWNERSHIP_INVALID,
    );
  }

  private assertAsset(
    asset: MediaAsset,
    requiredPrefix: `${string}/`,
    message: string,
    code: ApiErrorCode,
  ): void {
    const env = this.config.get('appEnv', { infer: true });
    const isValid =
      asset.objectKey.startsWith(requiredPrefix) &&
      isAllowedProductAssetUrl(asset.publicUrl, asset.objectKey, env);
    if (isValid) return;

    throw new UnprocessableEntityException({ code, message });
  }
}
