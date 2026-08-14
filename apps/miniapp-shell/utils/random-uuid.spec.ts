import { describe, expect, it } from 'vitest';

import { requireUuidV4, uuidV4FromBytes } from './random-uuid.js';

describe('miniapp secure UUID', () => {
  it('sets RFC 4122 version and variant bits from secure bytes', () => {
    const value = uuidV4FromBytes(new Uint8Array(16).buffer);

    expect(value).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('accepts injected async UUID factories and rejects unsafe values', async () => {
    await expect(
      requireUuidV4(async () => '12345678-1234-4234-9234-123456789abc'),
    ).resolves.toBe('12345678-1234-4234-9234-123456789abc');
    await expect(requireUuidV4(() => 'not-random')).rejects.toThrow(
      '无法生成安全的操作标识',
    );
  });
});
