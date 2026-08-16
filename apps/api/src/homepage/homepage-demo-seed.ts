import {
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { HomepageDraftConfig, MediaAsset } from '@bake-mall/contracts';

import { type AppEnv, validateEnvironment } from '../config/env.schema.js';
import { HomepageDraft } from '../database/entities/homepage-draft.entity.js';
import { isAllowedProductAssetUrl } from '../catalog/media-asset-policy.service.js';
import { joinMediaUrl } from '../media-url.js';
import { createObjectStorageClient } from '../object-storage/object-storage-client.js';
import {
  createHomepageDemoConfig,
  homepageDemoObjectKey,
} from './homepage-demo-config.js';
import { loadHomepageDemoFixture } from './homepage-demo-fixture.js';
import { HomepageService } from './homepage.service.js';

const DEMO_DRAFT_NAME = '专业烘焙示例（开发）';
const CANONICAL_UNSIGNED_BIGINT_ID = /^(?:[1-9][0-9]*)$/u;
const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;

export type HomepageDemoSeedInput = Readonly<{
  adminId: string;
  replace: boolean;
  dryRun: boolean;
}>;

export type HomepageDemoSeedDependencies = Readonly<{
  prepareAssets: (
    dryRun: boolean,
  ) => Promise<{ readonly config: HomepageDraftConfig; readonly uploaded: number }>;
  findDraftByName: (
    name: string,
  ) => Promise<{ readonly id: string; readonly version: number } | null>;
  createConfiguredDraft: (
    config: HomepageDraftConfig,
    adminId: string,
  ) => Promise<{ readonly id: string; readonly version: number }>;
  saveDraft: (
    id: string,
    config: HomepageDraftConfig,
    version: number,
    adminId: string,
  ) => Promise<{ readonly id: string; readonly version: number }>;
}>;

export type HomepageDemoSeedResult =
  | Readonly<{ action: 'noop'; draftId: string; uploaded: 0 }>
  | Readonly<{ action: 'dry-run'; uploaded: 0 }>
  | Readonly<{
      action: 'created' | 'replaced';
      draftId: string;
      uploaded: number;
    }>;

type HomepageDemoSeedApplication = Pick<
  INestApplicationContext,
  'close' | 'get'
>;

export type HomepageDemoSeedCliDependencies = Readonly<{
  validateDryRun: () => Promise<void>;
  createApplicationContext: () => Promise<HomepageDemoSeedApplication>;
  createSeedDependencies: (
    application: HomepageDemoSeedApplication,
  ) => HomepageDemoSeedDependencies;
}>;

const valueAfter = (args: readonly string[], flag: string): string | null => {
  const index = args.indexOf(flag);
  return index === -1 ? null : (args[index + 1] ?? null);
};

const isCanonicalUnsignedBigIntId = (value: string | null): value is string =>
  value !== null &&
  CANONICAL_UNSIGNED_BIGINT_ID.test(value) &&
  BigInt(value) <= MAX_UNSIGNED_BIGINT;

export function parseHomepageDemoSeedArguments(
  args: readonly string[],
  nodeEnv: string | undefined,
): HomepageDemoSeedInput {
  const normalizedArgs = args.filter((argument) => argument !== '--');
  const adminId = valueAfter(normalizedArgs, '--admin-id');
  const replace = normalizedArgs.includes('--replace');
  const dryRun = normalizedArgs.includes('--dry-run');
  const unknown = normalizedArgs.filter(
    (argument, index) =>
      !['--admin-id', '--replace', '--dry-run'].includes(argument) &&
      normalizedArgs[index - 1] !== '--admin-id',
  );
  if (!isCanonicalUnsignedBigIntId(adminId) || unknown.length > 0) {
    throw new Error(
      'Usage: homepage:seed-demo -- --admin-id <canonical unsigned BIGINT> [--replace] [--dry-run]',
    );
  }
  if (replace && !['development', 'test'].includes(nodeEnv ?? '')) {
    throw new Error('--replace 仅允许在 development 或 test 环境使用');
  }
  return { adminId, replace, dryRun };
}

export async function runHomepageDemoSeedCli(
  input: HomepageDemoSeedInput,
  dependencies: HomepageDemoSeedCliDependencies,
): Promise<HomepageDemoSeedResult> {
  if (input.dryRun) {
    await dependencies.validateDryRun();
    return { action: 'dry-run', uploaded: 0 };
  }
  const application = await dependencies.createApplicationContext();
  try {
    return await seedHomepageDemo(
      input,
      dependencies.createSeedDependencies(application),
    );
  } finally {
    await application.close();
  }
}

export async function seedHomepageDemo(
  input: HomepageDemoSeedInput,
  dependencies: HomepageDemoSeedDependencies,
): Promise<HomepageDemoSeedResult> {
  const existing = await dependencies.findDraftByName(DEMO_DRAFT_NAME);
  if (existing && !input.replace) {
    return { action: 'noop', draftId: existing.id, uploaded: 0 };
  }
  const prepared = await dependencies.prepareAssets(input.dryRun);
  if (input.dryRun) return { action: 'dry-run', uploaded: 0 };
  if (existing) {
    await dependencies.saveDraft(
      existing.id,
      prepared.config,
      existing.version,
      input.adminId,
    );
    return {
      action: 'replaced',
      draftId: existing.id,
      uploaded: prepared.uploaded,
    };
  }
  const created = await dependencies.createConfiguredDraft(
    prepared.config,
    input.adminId,
  );
  return {
    action: 'created',
    draftId: created.id,
    uploaded: prepared.uploaded,
  };
}

type HomepageDemoObjectStorageClient = Pick<S3Client, 'send'>;
type HomepageDemoObjectStorageEnv = Pick<
  AppEnv,
  'OBJECT_STORAGE_BUCKET' | 'OBJECT_STORAGE_PUBLIC_BASE_URL'
>;
type LoadedHomepageDemoAsset = Awaited<
  ReturnType<typeof loadHomepageDemoFixture>
>['assets'][number];
type HomepageDemoObjectAsset = Pick<
  LoadedHomepageDemoAsset,
  'role' | 'bytes' | 'byteLength' | 'detected'
> & {
  readonly manifest: Pick<LoadedHomepageDemoAsset['manifest'], 'fileName'>;
};

export async function ensureHomepageDemoObject(
  client: HomepageDemoObjectStorageClient,
  env: HomepageDemoObjectStorageEnv,
  asset: HomepageDemoObjectAsset,
): Promise<Readonly<{ media: MediaAsset; uploaded: boolean }>> {
  const objectKey = homepageDemoObjectKey(asset);
  const media = {
    objectKey,
    publicUrl: joinMediaUrl(env.OBJECT_STORAGE_PUBLIC_BASE_URL, objectKey),
  };
  const head = await client
    .send(
      new HeadObjectCommand({
        Bucket: env.OBJECT_STORAGE_BUCKET,
        Key: objectKey,
      }),
    )
    .catch((error: unknown) => {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    });
  if (head) {
    if (
      head.ContentLength !== asset.byteLength ||
      head.ContentType !== asset.detected.mime ||
      head.Metadata?.sha256 !== asset.detected.sha256
    ) {
      throw new Error(`对象存储中的首页示例素材元数据冲突: ${objectKey}`);
    }
    return { media, uploaded: false };
  }
  await client.send(
    new PutObjectCommand({
      Bucket: env.OBJECT_STORAGE_BUCKET,
      Key: objectKey,
      Body: asset.bytes,
      ContentType: asset.detected.mime,
      Metadata: { sha256: asset.detected.sha256 },
    }),
  );
  const confirmed = await client.send(
    new HeadObjectCommand({
      Bucket: env.OBJECT_STORAGE_BUCKET,
      Key: objectKey,
    }),
  );
  if (
    confirmed.ContentLength !== asset.byteLength ||
    confirmed.ContentType !== asset.detected.mime ||
    confirmed.Metadata?.sha256 !== asset.detected.sha256
  ) {
    throw new Error(`首页示例素材上传确认失败: ${objectKey}`);
  }
  return { media, uploaded: true };
}

const createMedia = (
  env: AppEnv,
  asset: Awaited<ReturnType<typeof loadHomepageDemoFixture>>['assets'][number],
): MediaAsset => {
  const objectKey = homepageDemoObjectKey(asset);
  const media = {
    objectKey,
    publicUrl: joinMediaUrl(env.OBJECT_STORAGE_PUBLIC_BASE_URL, objectKey),
  };
  if (
    !objectKey.startsWith('homepage/') ||
    !isAllowedProductAssetUrl(media.publicUrl, objectKey, env)
  ) {
    throw new Error(`首页示例素材 URL 不符合 MediaAssetPolicy: ${objectKey}`);
  }
  return media;
};

async function validateHomepageDemoFixture(env: AppEnv): Promise<void> {
  const fixture = await loadHomepageDemoFixture();
  createHomepageDemoConfig(
    new Map(fixture.assets.map((asset) => [asset.role, createMedia(env, asset)])),
  );
}

const createHomepageDemoSeedDependencies = (
  application: HomepageDemoSeedApplication,
  env: AppEnv,
): HomepageDemoSeedDependencies => {
  const homepage = application.get(HomepageService);
  const drafts = application.get<Repository<HomepageDraft>>(
    getRepositoryToken(HomepageDraft),
  );
  const client = createObjectStorageClient(env);
  return {
    findDraftByName: async (name) => {
      const draft = await drafts.findOne({ where: { name } });
      return draft ? { id: draft.id, version: draft.version } : null;
    },
    prepareAssets: async (dryRun) => {
      const fixture = await loadHomepageDemoFixture();
      const prepared = await Promise.all(
        fixture.assets.map((asset) =>
          dryRun
            ? Promise.resolve({ media: createMedia(env, asset), uploaded: false })
            : ensureHomepageDemoObject(client, env, asset),
        ),
      );
      return {
        config: createHomepageDemoConfig(
          new Map(
            fixture.assets.map((asset, index) => [
              asset.role,
              prepared[index]!.media,
            ]),
          ),
        ),
        uploaded: prepared.filter(({ uploaded }) => uploaded).length,
      };
    },
    createConfiguredDraft: async (config, adminId) =>
      homepage.createDraftWithConfig(DEMO_DRAFT_NAME, config, adminId),
    saveDraft: async (id, config, version, adminId) =>
      homepage.saveDraftById(id, { config, version }, adminId),
  };
};

async function main(): Promise<void> {
  loadDotenv({ path: resolve(__dirname, '../../../../.env.development') });
  const input = parseHomepageDemoSeedArguments(
    process.argv.slice(2),
    process.env.NODE_ENV,
  );
  const env = validateEnvironment(process.env);
  if (env.NODE_ENV === 'production') {
    throw new Error('homepage:seed-demo 禁止在 production 环境运行');
  }
  const result = await runHomepageDemoSeedCli(input, {
    validateDryRun: () => validateHomepageDemoFixture(env),
    createApplicationContext: async () => {
      const { HomepageDemoSeedModule } = await import(
        './homepage-demo-seed.module.js'
      );
      return NestFactory.createApplicationContext(HomepageDemoSeedModule, {
        logger: ['error', 'warn'],
      });
    },
    createSeedDependencies: (application) =>
      createHomepageDemoSeedDependencies(application, env),
  });
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error(`Homepage demo seed failed: ${message}`);
    process.exitCode = 1;
  });
}
