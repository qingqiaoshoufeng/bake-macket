import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRootUrl } from './url-helper.mjs';

test('resolveRootUrl preserves a root-domain base and resolves routes', () => {
  assert.equal(
    resolveRootUrl('https://mall.example.com', '/products'),
    'https://mall.example.com/products',
  );
  assert.equal(
    resolveRootUrl('https://admin.example.com/', 'login'),
    'https://admin.example.com/login',
  );
});

test('resolveRootUrl rejects deployment subpaths', () => {
  assert.throws(
    () => resolveRootUrl('https://mall.example.com/store', '/products'),
    /domain root/i,
  );
});
