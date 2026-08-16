import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const FIXTURE_DIRECTORY = join(
  __dirname,
  'fixtures',
  'homepage-demo-v1',
);
const MAX_ASSET_BYTES = 5 * 1024 * 1024;

export const HOMEPAGE_DEMO_ASSET_ROLES = [
  'hero-birthday',
  'hero-afternoon-tea',
  'shortcut-cake',
  'shortcut-bread',
  'shortcut-gift',
  'shortcut-service',
  'block-morning-bread',
  'block-weekend-box',
  'customer-service-placeholder',
] as const;

export type HomepageDemoAssetRole =
  (typeof HOMEPAGE_DEMO_ASSET_ROLES)[number];

type HomepageDemoAssetManifest = {
  readonly role: HomepageDemoAssetRole;
  readonly fileName: string;
  readonly purpose: string;
  readonly mime: 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly source: {
    readonly platform: string;
    readonly photoId: string | null;
    readonly url: string;
    readonly pageUrl: string | null;
    readonly author: string | null;
  };
};

type HomepageDemoManifest = {
  readonly version: 1;
  readonly acquiredAt: '2026-08-16';
  readonly licenseUrl: 'https://unsplash.com/license';
  readonly assets: readonly HomepageDemoAssetManifest[];
};

type DetectedAsset = {
  readonly mime: 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
};

export type LoadedHomepageDemoAsset = {
  readonly role: HomepageDemoAssetRole;
  readonly path: string;
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly manifest: HomepageDemoAssetManifest;
  readonly detected: DetectedAsset;
};

export type LoadedHomepageDemoFixture = {
  readonly manifest: HomepageDemoManifest;
  readonly assets: readonly LoadedHomepageDemoAsset[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readWebpDimensions(bytes: Buffer): Readonly<{
  width: number;
  height: number;
}> {
  if (
    bytes.length < 30 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('首页示例素材不是有效的 WebP 文件');
  }
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    if (
      bytes[23] !== 0x9d ||
      bytes[24] !== 0x01 ||
      bytes[25] !== 0x2a
    ) {
      throw new Error('首页示例 WebP VP8 帧头无效');
    }
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X') {
    return {
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
    };
  }
  throw new Error(`不支持的首页示例 WebP chunk: ${chunk}`);
}

function parseManifest(value: unknown): HomepageDemoManifest {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.acquiredAt !== '2026-08-16' ||
    value.licenseUrl !== 'https://unsplash.com/license' ||
    !Array.isArray(value.assets)
  ) {
    throw new Error('首页示例素材 manifest 根结构无效');
  }
  const roles = value.assets.map((asset) =>
    isRecord(asset) ? asset.role : null,
  );
  if (
    roles.length !== HOMEPAGE_DEMO_ASSET_ROLES.length ||
    !HOMEPAGE_DEMO_ASSET_ROLES.every((role, index) => roles[index] === role)
  ) {
    throw new Error('首页示例素材 manifest 角色不完整或顺序无效');
  }
  const assetsValid = value.assets.every(
    (asset) =>
      isRecord(asset) &&
      typeof asset.fileName === 'string' &&
      basename(asset.fileName) === asset.fileName &&
      extname(asset.fileName) === '.webp' &&
      typeof asset.purpose === 'string' &&
      asset.mime === 'image/webp' &&
      Number.isInteger(asset.width) &&
      Number.isInteger(asset.height) &&
      typeof asset.sha256 === 'string' &&
      /^[0-9a-f]{64}$/u.test(asset.sha256) &&
      isRecord(asset.source) &&
      typeof asset.source.platform === 'string' &&
      (asset.source.platform !== 'Unsplash' ||
        (typeof asset.source.photoId === 'string' &&
          asset.source.photoId.trim().length > 0 &&
          typeof asset.source.pageUrl === 'string' &&
          asset.source.pageUrl.trim().length > 0 &&
          typeof asset.source.author === 'string' &&
          asset.source.author.trim().length > 0)) &&
      (typeof asset.source.photoId === 'string' || asset.source.photoId === null) &&
      typeof asset.source.url === 'string' &&
      (typeof asset.source.pageUrl === 'string' || asset.source.pageUrl === null) &&
      (typeof asset.source.author === 'string' || asset.source.author === null),
  );
  if (!assetsValid) throw new Error('首页示例素材 manifest 条目无效');
  return value as HomepageDemoManifest;
}

async function loadAsset(
  manifest: HomepageDemoAssetManifest,
): Promise<LoadedHomepageDemoAsset> {
  const path = join(FIXTURE_DIRECTORY, manifest.fileName);
  const bytes = await readFile(path);
  if (bytes.length === 0 || bytes.length >= MAX_ASSET_BYTES) {
    throw new Error(`首页示例素材大小无效: ${manifest.fileName}`);
  }
  const dimensions = readWebpDimensions(bytes);
  const detected = {
    mime: 'image/webp' as const,
    ...dimensions,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  if (
    detected.width !== manifest.width ||
    detected.height !== manifest.height ||
    detected.sha256 !== manifest.sha256
  ) {
    throw new Error(`首页示例素材校验失败: ${manifest.fileName}`);
  }
  return {
    role: manifest.role,
    path,
    bytes,
    byteLength: bytes.length,
    manifest,
    detected,
  };
}

export async function loadHomepageDemoFixture(): Promise<LoadedHomepageDemoFixture> {
  const manifest = parseManifest(
    JSON.parse(await readFile(join(FIXTURE_DIRECTORY, 'manifest.json'), 'utf8')),
  );
  return {
    manifest,
    assets: await Promise.all(manifest.assets.map(loadAsset)),
  };
}
