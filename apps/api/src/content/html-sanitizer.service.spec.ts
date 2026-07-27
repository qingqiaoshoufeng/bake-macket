import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { AppConfig, AppEnv } from '../config/env.schema.js';
import { HtmlSanitizerService } from './html-sanitizer.service.js';

const buildSanitizer = (env: AppEnv): HtmlSanitizerService =>
  new HtmlSanitizerService({
    get: () => env,
  } as unknown as ConfigService<AppConfig, true>);

describe('HtmlSanitizerService', () => {
  it('keeps configured MinIO and CDN images while removing other origins', () => {
    const service = buildSanitizer({
      NODE_ENV: 'development',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'http://127.0.0.1:9000/bake-mall',
      PRODUCT_MEDIA_ALLOWED_ORIGINS: [
        'http://127.0.0.1:9000',
        'https://cdn.example.com',
      ],
    } as AppEnv);

    expect(
      service.sanitize(
        '<img src="http://127.0.0.1:9000/bake-mall/products/a.webp">' +
          '<img src="https://cdn.example.com/products/b.webp">' +
          '<img src="https://evil.example/products/c.webp">',
      ),
    ).toBe(
      '<img src="http://127.0.0.1:9000/bake-mall/products/a.webp" />' +
        '<img src="https://cdn.example.com/products/b.webp" />',
    );
  });

  it('removes HTTP images in production even when their origin is configured', () => {
    const service = buildSanitizer({
      NODE_ENV: 'production',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://cos.example.com/bake-mall',
      PRODUCT_MEDIA_ALLOWED_ORIGINS: ['http://127.0.0.1:9000'],
    } as AppEnv);

    expect(
      service.sanitize(
        '<img src="http://127.0.0.1:9000/bake-mall/products/a.webp">' +
          '<img src="https://cos.example.com/bake-mall/products/b.webp">',
      ),
    ).toBe('<img src="https://cos.example.com/bake-mall/products/b.webp" />');
  });

  it('keeps HTTPS links but does not extend the image HTTP exception to links', () => {
    const service = buildSanitizer({
      NODE_ENV: 'development',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'http://127.0.0.1:9000/bake-mall',
      PRODUCT_MEDIA_ALLOWED_ORIGINS: ['http://127.0.0.1:9000'],
    } as AppEnv);

    expect(
      service.sanitize(
        '<a href="http://127.0.0.1:9000/path">local</a>' +
          '<a href="https://example.com/path">secure</a>',
      ),
    ).toBe('<a>local</a><a href="https://example.com/path">secure</a>');
  });
});
