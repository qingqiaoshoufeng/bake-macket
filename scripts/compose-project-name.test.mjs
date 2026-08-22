import assert from 'node:assert/strict';

import { composeProjectName } from './compose.mjs';

const projectName = composeProjectName();

assert.equal(projectName, 'bake-mall-main');
assert.match(projectName, /^[a-z0-9][a-z0-9_-]*$/);
