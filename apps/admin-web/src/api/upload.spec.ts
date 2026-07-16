import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from './http.js';
import { performUpload, uploadApi } from './upload.js';

const response = {
  objectKey: 'products/cake.webp',
  publicUrl: 'https://cdn.example.com/products/cake.webp',
  uploadUrl: 'http://127.0.0.1:9000/bake-mall',
  fields: { key: 'products/cake.webp' },
  expiresAt: '2026-07-16T00:05:00.000Z',
};

describe('performUpload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the file to uploadUrl while returning publicUrl for persistence', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue(response);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const file = new File(['cake'], 'cake.webp', { type: 'image/webp' });

    const result = await performUpload(file, 'products');

    expect(uploadApi.presign).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      response.uploadUrl,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.publicUrl).toBe(response.publicUrl);
    expect(result.publicUrl).not.toBe(response.uploadUrl);
  });
});
