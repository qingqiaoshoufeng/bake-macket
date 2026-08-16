import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import type { HomepageDraftConfig } from '@bake-mall/contracts';

import {
  ensureHomepageDemoObject,
  parseHomepageDemoSeedArguments,
  runHomepageDemoSeedCli,
  seedHomepageDemo,
  type HomepageDemoSeedDependencies,
} from './homepage-demo-seed.js';

const config = { schemaVersion: 1 } as HomepageDraftConfig;

const createDependencies = (
  existing: { id: string; version: number } | null,
): HomepageDemoSeedDependencies => ({
  prepareAssets: vi.fn().mockResolvedValue({ config, uploaded: 9 }),
  findDraftByName: vi.fn().mockResolvedValue(existing),
  createConfiguredDraft: vi.fn().mockResolvedValue({
    id: 'draft-new',
    version: 1,
  }),
  saveDraft: vi.fn().mockResolvedValue({ id: 'draft-existing', version: 4 }),
});

describe('首页专业示例 seed 参数', () => {
  it('要求 canonical unsigned BIGINT admin id 并拒绝生产 replace', () => {
    expect(
      parseHomepageDemoSeedArguments(
        ['--', '--admin-id', '42', '--dry-run'],
        'development',
      ),
    ).toEqual({ adminId: '42', replace: false, dryRun: true });
    expect(() =>
      parseHomepageDemoSeedArguments(['--admin-id', '042'], 'development'),
    ).toThrow(/canonical unsigned BIGINT/u);
    expect(() =>
      parseHomepageDemoSeedArguments(['--admin-id', '42', '--replace'], 'production'),
    ).toThrow(/development 或 test/u);
  });
});

describe('首页专业示例对象存储', () => {
  it.each([
    ['缺失', undefined],
    ['不同', '0'.repeat(64)],
  ])('已存在对象的完整 sha256 metadata %s时拒绝复用', async (_, sha256) => {
    const client = {
      send: vi.fn((command) => {
        expect(command).toBeInstanceOf(HeadObjectCommand);
        return Promise.resolve({
          ContentLength: 123,
          ContentType: 'image/webp',
          Metadata: sha256 === undefined ? {} : { sha256 },
        });
      }),
    };
    const asset = {
      role: 'hero-birthday' as const,
      manifest: { fileName: 'fixture.webp' },
      bytes: Buffer.from('fixture'),
      byteLength: 123,
      detected: {
        mime: 'image/webp' as const,
        width: 1500,
        height: 2668,
        sha256: 'a'.repeat(64),
      },
    };

    await expect(
      ensureHomepageDemoObject(
        client,
        {
          OBJECT_STORAGE_BUCKET: 'bake-mall',
          OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://media.example.test/bake-mall',
        },
        asset,
      ),
    ).rejects.toThrow(/元数据冲突/u);
    expect(client.send).toHaveBeenCalledOnce();
  });
});

describe('首页专业示例 seed CLI', () => {
  it('dry-run 仅执行纯校验，不创建上下文或触发数据库与对象存储副作用', async () => {
    const validateDryRun = vi.fn().mockResolvedValue(undefined);
    const createApplicationContext = vi.fn();
    const findDraftByName = vi.fn();
    const createConfiguredDraft = vi.fn();
    const saveDraft = vi.fn();
    const upload = vi.fn();

    await expect(
      runHomepageDemoSeedCli(
        { adminId: '42', replace: false, dryRun: true },
        {
          validateDryRun,
          createApplicationContext,
          createSeedDependencies: vi.fn(() => ({
            prepareAssets: upload,
            findDraftByName,
            createConfiguredDraft,
            saveDraft,
          })),
        },
      ),
    ).resolves.toEqual({ action: 'dry-run', uploaded: 0 });
    expect(validateDryRun).toHaveBeenCalledOnce();
    expect(createApplicationContext).not.toHaveBeenCalled();
    expect(findDraftByName).not.toHaveBeenCalled();
    expect(createConfiguredDraft).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('seedHomepageDemo', () => {
  it('同名草稿存在时默认 no-op，且不上传或覆盖', async () => {
    const dependencies = createDependencies({ id: 'draft-existing', version: 3 });

    await expect(
      seedHomepageDemo(
        { adminId: '42', replace: false, dryRun: false },
        dependencies,
      ),
    ).resolves.toEqual({ action: 'noop', draftId: 'draft-existing', uploaded: 0 });
    expect(dependencies.prepareAssets).not.toHaveBeenCalled();
    expect(dependencies.createConfiguredDraft).not.toHaveBeenCalled();
    expect(dependencies.saveDraft).not.toHaveBeenCalled();
  });

  it('新建时先校验上传素材，再通过 HomepageService 原子创建完整配置草稿', async () => {
    const dependencies = createDependencies(null);

    await expect(
      seedHomepageDemo(
        { adminId: '42', replace: false, dryRun: false },
        dependencies,
      ),
    ).resolves.toEqual({ action: 'created', draftId: 'draft-new', uploaded: 9 });
    expect(dependencies.createConfiguredDraft).toHaveBeenCalledWith(config, '42');
    expect(dependencies.saveDraft).not.toHaveBeenCalled();
  });

  it('dry-run 只校验素材和配置，不写草稿且绝不发布', async () => {
    const dependencies = createDependencies(null);

    await expect(
      seedHomepageDemo(
        { adminId: '42', replace: false, dryRun: true },
        dependencies,
      ),
    ).resolves.toEqual({ action: 'dry-run', uploaded: 0 });
    expect(dependencies.prepareAssets).toHaveBeenCalledWith(true);
    expect(dependencies.createConfiguredDraft).not.toHaveBeenCalled();
    expect(dependencies.saveDraft).not.toHaveBeenCalled();
  });

  it('replace 使用现有草稿版本走同一保存入口', async () => {
    const dependencies = createDependencies({ id: 'draft-existing', version: 3 });

    await expect(
      seedHomepageDemo(
        { adminId: '42', replace: true, dryRun: false },
        dependencies,
      ),
    ).resolves.toEqual({
      action: 'replaced',
      draftId: 'draft-existing',
      uploaded: 9,
    });
    expect(dependencies.saveDraft).toHaveBeenCalledWith(
      'draft-existing',
      config,
      3,
      '42',
    );
  });
});
