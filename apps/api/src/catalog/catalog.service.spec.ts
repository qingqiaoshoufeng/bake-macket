import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { sanitizeProductHtml } from '../content/html-sanitizer.service.js';
import { CatalogService } from './catalog.service.js';

describe('catalog safety', () => {
  it('removes scripts, event handlers, and non-COS image URLs', () => {
    const html =
      '<p onclick="alert(1)">safe</p><script>alert(1)</script><img src="https://evil.test/a.png">';
    expect(sanitizeProductHtml(html)).toBe('<p>safe</p>');
  });

  it('rejects a SKU with a negative stock or non-integer price', async () => {
    const service = new CatalogService(
      {} as never,
      {} as never,
      {
        findOne: vi.fn().mockResolvedValue({ id: '1' }),
        create: vi.fn(),
        save: vi.fn(),
      } as never,
      {} as never,
      { sanitize: vi.fn() } as never,
    );

    await expect(
      service.createSku('1', { name: '6寸', priceCents: 68.5, stock: -1 }),
    ).rejects.toThrow(BadRequestException);
  });
});
