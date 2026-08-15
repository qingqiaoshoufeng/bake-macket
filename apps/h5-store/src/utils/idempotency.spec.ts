import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateIdempotencyKey } from './idempotency.js';

const originalCrypto = globalThis.crypto;

function setCrypto(value: Partial<Crypto> | undefined): void {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  setCrypto(originalCrypto);
  vi.restoreAllMocks();
});

describe('generateIdempotencyKey', () => {
  it('禁用 randomUUID 时使用 getRandomValues 生成 RFC 4122 v4 UUID', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    });
    setCrypto({ getRandomValues } as Partial<Crypto>);

    const key = generateIdempotencyKey();

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(key).toBe('abababab-abab-4bab-abab-abababababab');
  });

  it('没有安全随机源时明确失败且不使用 Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    setCrypto(undefined);

    expect(() => generateIdempotencyKey()).toThrow('缺少安全随机源');
    expect(random).not.toHaveBeenCalled();
  });
});
