import { describe, expect, it } from 'vitest';

import { resolveSafeInternalRedirect } from './redirect.js';

describe('resolveSafeInternalRedirect', () => {
  it.each([
    undefined,
    null,
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/path with space',
    '/path\nnext',
    ['/checkout'],
  ])('拒绝不安全或歧义 redirect: %#', (value) => {
    expect(resolveSafeInternalRedirect(value)).toBe('/');
  });

  it.each(['/checkout', '/orders/1?tab=detail#items', '/'])(
    '接受站内路径: %s',
    (value) => {
      expect(resolveSafeInternalRedirect(value)).toBe(value);
    },
  );
});
