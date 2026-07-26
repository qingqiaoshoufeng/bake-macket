import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfig, AppEnv } from '../config/env.schema.js';
import { UploadService } from './upload.service.js';

vi.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: vi.fn().mockResolvedValue({
    url: 'http://127.0.0.1:9000/bake-mall',
    fields: { key: 'products/generated.webp' },
  }),
}));

const env: AppEnv = {
  NODE_ENV: 'test',
  PORT: 3015,
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: 3306,
  MYSQL_DATABASE: 'bake_mall',
  MYSQL_USER: 'bake_app',
  MYSQL_PASSWORD: 'password',
  JWT_USER_SECRET: 'user-secret-at-least-16',
  JWT_ADMIN_SECRET: 'admin-secret-at-least-16',
  JWT_EXPIRES_IN_SECONDS: 3600,
  SIMULATED_PAYMENT_ENABLED: true,
  ORDER_QUOTE_TOKEN_SECRET: 'order-quote-secret-at-least-32-chars',
  ORDER_QUOTE_TTL_SECONDS: 300,
  OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
  OBJECT_STORAGE_PUBLIC_BASE_URL: 'http://127.0.0.1:9000/bake-mall',
  PRODUCT_MEDIA_ALLOWED_ORIGINS: ['http://127.0.0.1:9000'],
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_BUCKET: 'bake-mall',
  OBJECT_STORAGE_ACCESS_KEY: 'minioadmin',
  OBJECT_STORAGE_SECRET_KEY: 'minioadmin',
  OBJECT_STORAGE_FORCE_PATH_STYLE: true,
};

function createService(overrides: Partial<AppEnv> = {}): UploadService {
  const config = {
    get: vi.fn().mockReturnValue({ ...env, ...overrides }),
  } as unknown as ConfigService<AppConfig, true>;
  return new UploadService(config);
}

describe('UploadService', () => {
  it('normalizes every trailing slash before issuing a public URL', async () => {
    const result = await createService({
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'http://127.0.0.1:9000/bake-mall///',
    }).presign({
      scope: 'products',
      fileName: 'cake.webp',
      contentType: 'image/webp',
      sizeBytes: 1024,
    });

    expect(result.publicUrl).toBe(
      `http://127.0.0.1:9000/bake-mall/${result.objectKey}`,
    );
  });

  it('returns distinct upload and public URLs with the generated object key', async () => {
    const result = await createService().presign({
      scope: 'products',
      fileName: 'cake.webp',
      contentType: 'image/webp',
      sizeBytes: 1024,
    });

    expect(result.objectKey).toMatch(/^products\/.+\.webp$/);
    expect(result.uploadUrl).toBe('http://127.0.0.1:9000/bake-mall');
    expect(result.publicUrl).toBe(
      `http://127.0.0.1:9000/bake-mall/${result.objectKey}`,
    );
    expect(result.publicUrl).not.toBe(result.uploadUrl);
    expect(result.expiresAt).toEqual(expect.any(String));
  });
});
