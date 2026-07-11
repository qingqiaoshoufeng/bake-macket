import assert from 'node:assert/strict';

import { composeProjectName } from './compose.mjs';

const outcropRidge = composeProjectName('outcrop-ridge');
const checkoutV2 = composeProjectName('feature/Checkout V2');

assert.equal(outcropRidge, 'bake-mall-outcrop-ridge');
assert.equal(checkoutV2, 'bake-mall-feature-checkout-v2');
assert.match(outcropRidge, /^[a-z0-9][a-z0-9_-]*$/);
assert.match(checkoutV2, /^[a-z0-9][a-z0-9_-]*$/);
assert.notEqual(outcropRidge, checkoutV2);
