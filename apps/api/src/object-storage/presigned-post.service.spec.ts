import { ConfigService } from '@nestjs/config';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig, AppEnv } from '../config/env.schema.js';
import { PresignedPostService } from './presigned-post.service.js';

vi.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: vi.fn().mockResolvedValue({
    url: 'https://storage.example/upload',
    fields: { key: 'signed-key' },
  }),
}));

const env = {
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_ENDPOINT: 'http://minio.internal:9000',
  OBJECT_STORAGE_CLIENT_ENDPOINT: 'https://storage.example',
  OBJECT_STORAGE_FORCE_PATH_STYLE: true,
  OBJECT_STORAGE_ACCESS_KEY: 'access',
  OBJECT_STORAGE_SECRET_KEY: 'secret',
  OBJECT_STORAGE_BUCKET: 'bake-mall',
} as AppEnv;

const service = () =>
  new PresignedPostService({
    get: vi.fn().mockReturnValue(env),
  } as unknown as ConfigService<AppConfig, true>);

describe('PresignedPostService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pins the exact object key, MIME and one-to-five-MiB content length', async () => {
    const expiresAt = new Date('2026-08-18T08:05:00.000Z');
    vi.setSystemTime(new Date('2026-08-18T08:00:00.000Z'));

    await expect(
      service().create({
        objectKey: 'users/1/avatars/generated.webp',
        contentType: 'image/webp',
        maxSizeBytes: 5 * 1024 * 1024,
      }),
    ).resolves.toEqual({
      uploadUrl: 'https://storage.example/upload',
      fields: { key: 'signed-key' },
      expiresAt: expiresAt.toISOString(),
    });

    expect(createPresignedPost).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.any(Object) }),
      {
        Bucket: 'bake-mall',
        Key: 'users/1/avatars/generated.webp',
        Fields: { 'Content-Type': 'image/webp' },
        Conditions: [
          ['content-length-range', 1, 5 * 1024 * 1024],
          { 'Content-Type': 'image/webp' },
          { key: 'users/1/avatars/generated.webp' },
        ],
        Expires: 300,
      },
    );
    const client = vi.mocked(createPresignedPost).mock.calls[0]?.[0];
    await expect(client?.config.endpoint?.()).resolves.toMatchObject({
      hostname: 'storage.example',
      protocol: 'https:',
    });
    vi.useRealTimers();
  });
});
