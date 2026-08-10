import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';

import {
  allocatePorts,
  buildE2eUrls,
  buildPackageManagerInvocation,
  isPortAvailable,
  parseComposePort,
  parseEnvFile,
  requireExistingServerEnvironment,
  runPlaywright,
  runPlaywrightWithPortRetry,
  runWithCleanup,
} from './e2e-runner.mjs';

test('parseComposePort accepts this project binding and rejects missing ports', () => {
  assert.equal(parseComposePort('127.0.0.1:44306', '44306'), 44306);
  assert.throws(() => parseComposePort('', '43306'), /not published/i);
  assert.throws(
    () => parseComposePort('127.0.0.1:44306', '43306'),
    /expected.*43306/i,
  );
});

test('buildPackageManagerInvocation uses cmd.exe for pnpm on Windows', () => {
  assert.deepEqual(buildPackageManagerInvocation('win32', ['services:up']), {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'pnpm', 'services:up'],
  });
  assert.deepEqual(buildPackageManagerInvocation('linux', ['services:up']), {
    command: 'pnpm',
    args: ['services:up'],
  });
});

test('buildE2eUrls derives root URLs from runner ports', () => {
  assert.deepEqual(
    buildE2eUrls({ PORT: '45101', H5_PORT: '45102', ADMIN_PORT: '45103' }),
    {
      apiUrl: 'http://127.0.0.1:45101',
      h5Url: 'http://127.0.0.1:45102',
      adminUrl: 'http://127.0.0.1:45103',
    },
  );
});

test('buildE2eUrls normalizes explicit root-domain URLs', () => {
  assert.deepEqual(
    buildE2eUrls({
      API_URL: 'https://api.example.com/api/v1/',
      H5_URL: 'https://mall.example.com/',
      ADMIN_URL: 'https://admin.example.com',
    }),
    {
      apiUrl: 'https://api.example.com',
      h5Url: 'https://mall.example.com',
      adminUrl: 'https://admin.example.com',
    },
  );
});

test('buildE2eUrls rejects frontend subpaths', () => {
  assert.throws(
    () => buildE2eUrls({ H5_URL: 'https://example.com/store' }),
    /domain root/i,
  );
});

test('parseEnvFile reads comments, quotes, and equals signs', () => {
  assert.deepEqual(
    parseEnvFile('# local\nMYSQL_PORT=43306\nTOKEN="a=b"\nEMPTY=\n'),
    { MYSQL_PORT: '43306', TOKEN: 'a=b', EMPTY: '' },
  );
});

test('existing-server mode requires disposable database and all URLs or ports', () => {
  assert.throws(
    () => requireExistingServerEnvironment({ E2E_USE_EXISTING_SERVERS: '1' }),
    /DATABASE_URL/,
  );
  assert.throws(
    () =>
      requireExistingServerEnvironment({
        E2E_USE_EXISTING_SERVERS: '1',
        DATABASE_URL: 'mysql://disposable',
      }),
    /H5_URL.*ADMIN_URL.*API_URL|PORT/i,
  );
  assert.doesNotThrow(() =>
    requireExistingServerEnvironment({
      E2E_USE_EXISTING_SERVERS: '1',
      DATABASE_URL: 'mysql://disposable',
      H5_URL: 'https://mall.example.com',
      ADMIN_URL: 'https://admin.example.com',
      API_URL: 'https://api.example.com',
    }),
  );
});

test('isPortAvailable detects whether the specified loopback port is occupied', async (t) => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  assert.equal(await isPortAvailable(address.port), false);

  await new Promise((resolve) => server.close(resolve));
  assert.equal(await isPortAvailable(address.port), true);
});

test('allocatePorts replaces a raced port allocation', async () => {
  const allocated = [45101, 45102, 45103, 45201, 45202, 45203];
  const unavailable = new Set([45101, 45102, 45103]);
  const ports = await allocatePorts({
    reservePort: async () => allocated.shift(),
    isPortAvailable: async (port) => !unavailable.has(port),
  });

  assert.deepEqual(ports, {
    PORT: '45201',
    H5_PORT: '45202',
    ADMIN_PORT: '45203',
  });
});

test('retries the complete Playwright service start after an address conflict', async () => {
  const allocatedPorts = [
    { PORT: '45101', H5_PORT: '45102', ADMIN_PORT: '45103' },
    { PORT: '45201', H5_PORT: '45202', ADMIN_PORT: '45203' },
  ];
  const calls = [];

  await runPlaywrightWithPortRetry(
    { DATABASE_URL: 'mysql://e2e' },
    async () => allocatedPorts.shift(),
    async (environment) => {
      calls.push(environment.PORT);
      if (calls.length === 1) throw new Error('webServer failed: EADDRINUSE');
    },
  );

  assert.deepEqual(calls, ['45101', '45201']);
});

test('preserves Playwright service address-conflict output in runner errors', async () => {
  const child = new EventEmitter();
  child.kill = () => true;
  child.stderr = new EventEmitter();
  const result = runPlaywright({}, () => {
    queueMicrotask(() => {
      child.stderr.emit('data', 'Error: EADDRINUSE: address already in use');
      child.emit('exit', 1);
    });
    return child;
  });

  await assert.rejects(result, /EADDRINUSE/);
});

test('does not retry non-address Playwright failures or leak retry attempts', async () => {
  let allocations = 0;
  let starts = 0;

  await assert.rejects(
    runPlaywrightWithPortRetry(
      { DATABASE_URL: 'mysql://e2e' },
      async () => {
        allocations += 1;
        return { PORT: '45101', H5_PORT: '45102', ADMIN_PORT: '45103' };
      },
      async () => {
        starts += 1;
        throw new Error('Playwright exited with 1');
      },
    ),
    /Playwright exited with 1/,
  );
  assert.equal(allocations, 1);
  assert.equal(starts, 1);
});

test('runWithCleanup always cleans up and preserves the work failure', async () => {
  const calls = [];
  const failure = new Error('playwright failed');

  await assert.rejects(
    runWithCleanup(
      async () => {
        calls.push('work');
        throw failure;
      },
      async () => {
        calls.push('cleanup');
      },
    ),
    failure,
  );
  assert.deepEqual(calls, ['work', 'cleanup']);
});
