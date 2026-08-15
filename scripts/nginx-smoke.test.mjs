import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';

const config = readFileSync(
  new URL('../infra/nginx.conf', import.meta.url),
  'utf8',
);

test('nginx serves H5 and Admin at separate domain-root ports', () => {
  assert.match(config, /listen 8080;/);
  assert.match(config, /root \/usr\/share\/nginx\/html\/h5;/);
  assert.match(config, /listen 8081;/);
  assert.match(config, /root \/usr\/share\/nginx\/html\/admin;/);
  assert.doesNotMatch(config, /location \/store\//);
  assert.doesNotMatch(config, /location \/admin\//);
  assert.equal(
    (config.match(/try_files \$uri \$uri\/ \/index\.html;/g) ?? []).length,
    2,
  );
});

test('nginx excludes H5 login handoff query parameters from access logs', () => {
  assert.match(
    config,
    /log_format bake_mall_safe[^;]*\$request_method \$uri \$server_protocol/s,
  );
  assert.doesNotMatch(config, /log_format bake_mall_safe[^;]*\$request_uri/s);
  assert.doesNotMatch(
    config,
    /log_format bake_mall_safe[^;]*\$request(?=[\s'])/s,
  );
  assert.equal(
    (
      config.match(
        /access_log \/var\/log\/nginx\/access\.log bake_mall_safe;/g,
      ) ?? []
    ).length,
    2,
  );
});

test('nginx prevents client request IDs from controlling API or response IDs', () => {
  assert.match(config, /map \$request_id \$bake_mall_request_id/);
  assert.match(config, /default \$request_id;/);
  assert.doesNotMatch(config, /map \$http_x_request_id \$final_request_id/);
  assert.doesNotMatch(
    config,
    /proxy_set_header X-Request-Id \$http_x_request_id;/,
  );
  assert.equal(
    (
      config.match(/proxy_set_header X-Request-Id \$bake_mall_request_id;/g) ??
      []
    ).length,
    2,
  );
  assert.equal(
    (
      config.match(/add_header X-Request-Id \$bake_mall_request_id always;/g) ??
      []
    ).length,
    2,
  );
  assert.match(
    config,
    /attacker-123[\s\S]*公网客户端不可决定请求 ID|公网客户端不可决定请求 ID[\s\S]*attacker-123/,
  );
});
