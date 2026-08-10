import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { composeProjectName } from './compose.mjs';
import environmentHelpers from './e2e-environment.cjs';

const { buildE2eUrls, parseEnvFile, requireExistingServerEnvironment } =
  environmentHelpers;
export { buildE2eUrls, parseEnvFile, requireExistingServerEnvironment };

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const developmentEnvPath = fileURLToPath(
  new URL('../.env.development', import.meta.url),
);
const developmentEnvExamplePath = fileURLToPath(
  new URL('../.env.development.example', import.meta.url),
);

export async function runWithCleanup(work, cleanup) {
  const outcome = await work().then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  try {
    await cleanup();
  } catch (cleanupError) {
    if (!('error' in outcome)) throw cleanupError;
    console.error('E2E cleanup also failed.', cleanupError);
  }
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

export function buildPackageManagerInvocation(platform, args) {
  return platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm', ...args] }
    : { command: 'pnpm', args };
}

function invocation(command, args) {
  return command === 'pnpm'
    ? buildPackageManagerInvocation(process.platform, args)
    : { command, args };
}

function run(command, args, options = {}) {
  const child = invocation(command, args);
  const result = spawnSync(child.command, child.args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    const cause = result.error ? `: ${result.error.message}` : '';
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.status ?? 'no status'}${result.stderr ? `: ${result.stderr}` : cause}`,
    );
  }
  return String(result.stdout ?? '').trim();
}

async function ensureDevelopmentEnv() {
  try {
    return parseEnvFile(await readFile(developmentEnvPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await copyFile(developmentEnvExamplePath, developmentEnvPath);
    return parseEnvFile(await readFile(developmentEnvPath, 'utf8'));
  }
}

function currentBranch() {
  return (
    run('git', ['branch', '--show-current'], { capture: true }) || 'detached'
  );
}

function composeArgs(projectName, args) {
  return [
    'compose',
    '--env-file',
    '.env.development',
    '-p',
    projectName,
    '-f',
    'infra/docker-compose.dev.yml',
    ...args,
  ];
}

function mysqlComposeExec(projectName, rootPassword, sql) {
  return run('docker', [
    ...composeArgs(projectName, ['exec', '-T', 'mysql']),
    'mysql',
    '-uroot',
    `-p${rootPassword}`,
    '--protocol=socket',
    '-e',
    sql,
  ]);
}

function randomIdentifier(prefix) {
  return `${prefix}_${process.pid}_${randomBytes(5).toString('hex')}`.replace(
    /[^a-zA-Z0-9_]/gu,
    '_',
  );
}

function sqlIdentifier(value) {
  return `\`${value.replaceAll('`', '``')}\``;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function createDatabaseUrl(environment, schema, user, password) {
  const port = environment.MYSQL_PORT ?? '43306';
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${schema}`;
}

export async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to reserve an E2E port.')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export async function allocatePorts(dependencies = {}) {
  const reserve = dependencies.reservePort ?? reservePort;
  const available = dependencies.isPortAvailable ?? isPortAvailable;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ports = await Promise.all([reserve(), reserve(), reserve()]);
    if ((await Promise.all(ports.map(available))).every(Boolean)) {
      return {
        PORT: String(ports[0]),
        H5_PORT: String(ports[1]),
        ADMIN_PORT: String(ports[2]),
      };
    }
  }
  throw new Error('Unable to allocate available E2E ports after 10 attempts.');
}

export function parseComposePort(binding, expectedPort) {
  if (!binding) {
    throw new Error(
      `This worktree MySQL port ${expectedPort} is not published; choose unused ports in .env.development and recreate this Compose project.`,
    );
  }
  const actualPort = binding.match(/:(\d+)$/u)?.[1];
  if (actualPort !== String(expectedPort)) {
    throw new Error(
      `This worktree MySQL binding ${binding} does not match expected port ${expectedPort}.`,
    );
  }
  return Number(actualPort);
}

function assertMysqlPortBinding(projectName, expectedPort) {
  const binding = run(
    'docker',
    composeArgs(projectName, ['port', 'mysql', '3306']),
    { capture: true },
  );
  parseComposePort(binding, expectedPort);
}

async function waitForMysql(projectName, rootPassword) {
  const attempts = Array.from({ length: 60 }, (_, index) => index);
  for (const attempt of attempts) {
    const result = spawnSync(
      'docker',
      [
        ...composeArgs(projectName, ['exec', '-T', 'mysql']),
        'mysqladmin',
        'ping',
        '-h',
        'localhost',
        '-uroot',
        `-p${rootPassword}`,
        '--silent',
      ],
      { cwd: repositoryRoot, stdio: 'ignore' },
    );
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000 + attempt * 10));
  }
  throw new Error('MySQL did not become ready for E2E provisioning.');
}

function provisionDatabase(projectName, rootPassword, schema, user, password) {
  const schemaId = sqlIdentifier(schema);
  const userValue = sqlString(user);
  const passwordValue = sqlString(password);
  mysqlComposeExec(
    projectName,
    rootPassword,
    [
      `CREATE DATABASE ${schemaId} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE USER ${userValue}@'%' IDENTIFIED BY ${passwordValue}`,
      `GRANT ALL PRIVILEGES ON ${schemaId}.* TO ${userValue}@'%'`,
      'FLUSH PRIVILEGES',
    ].join('; '),
  );
}

function cleanupDatabase(projectName, rootPassword, schema, user) {
  mysqlComposeExec(
    projectName,
    rootPassword,
    [
      `DROP DATABASE IF EXISTS ${sqlIdentifier(schema)}`,
      `DROP USER IF EXISTS ${sqlString(user)}@'%'`,
      'FLUSH PRIVILEGES',
    ].join('; '),
  );
}

function isPortConflict(error) {
  return /EADDRINUSE|strict port/iu.test(String(error?.message ?? error));
}

export async function runPlaywrightWithPortRetry(
  environment,
  allocate = allocatePorts,
  start = runPlaywright,
) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ports = await allocate();
    try {
      await start({ ...environment, ...ports });
      return;
    } catch (error) {
      lastError = error;
      if (!isPortConflict(error) || attempt === 1) throw error;
    }
  }
  throw lastError;
}

export function runPlaywright(environment, spawnProcess = spawn) {
  const playwright = invocation('pnpm', ['exec', 'playwright', 'test']);
  const child = spawnProcess(playwright.command, playwright.args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: ['ignore', 'inherit', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', terminate);
  process.once('SIGTERM', terminate);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', terminate);
      process.removeListener('SIGTERM', terminate);
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `Playwright exited with ${code ?? signal}${stderr ? `: ${stderr}` : ''}`,
          ),
        );
      }
    });
  });
}

async function runIsolated() {
  const developmentEnvironment = await ensureDevelopmentEnv();
  const projectName = composeProjectName(currentBranch());
  const rootPassword = developmentEnvironment.MYSQL_ROOT_PASSWORD;
  if (!rootPassword) {
    throw new Error('MYSQL_ROOT_PASSWORD is required for E2E provisioning.');
  }
  run('pnpm', ['services:up']);
  assertMysqlPortBinding(
    projectName,
    developmentEnvironment.MYSQL_PORT ?? '43306',
  );
  await waitForMysql(projectName, rootPassword);

  const schema = randomIdentifier('bake_e2e');
  const user = randomIdentifier('e2e_user');
  const password = randomBytes(24).toString('base64url');
  const databaseUrl = createDatabaseUrl(
    developmentEnvironment,
    schema,
    user,
    password,
  );
  const runnerEnvironment = {
    ...process.env,
    ...developmentEnvironment,
    DATABASE_URL: databaseUrl,
    E2E_DATABASE_SCHEMA: schema,
  };

  provisionDatabase(projectName, rootPassword, schema, user, password);
  await runWithCleanup(
    async () => {
      run('pnpm', ['--filter', '@bake-mall/contracts', 'build'], {
        env: runnerEnvironment,
      });
      run('pnpm', ['--filter', '@bake-mall/api', 'migration:run'], {
        env: runnerEnvironment,
      });
      await runPlaywrightWithPortRetry(
        runnerEnvironment,
        allocatePorts,
        async (environment) => {
          const urls = buildE2eUrls(environment);
          await runPlaywright({
            ...environment,
            API_URL: urls.apiUrl,
            H5_URL: urls.h5Url,
            ADMIN_URL: urls.adminUrl,
          });
        },
      );
    },
    async () => cleanupDatabase(projectName, rootPassword, schema, user),
  );
}

async function main() {
  requireExistingServerEnvironment(process.env);
  if (process.env.E2E_USE_EXISTING_SERVERS === '1') {
    const urls = buildE2eUrls(process.env);
    await runPlaywright({
      ...process.env,
      API_URL: urls.apiUrl,
      H5_URL: urls.h5Url,
      ADMIN_URL: urls.adminUrl,
    });
    return;
  }
  await runIsolated();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
