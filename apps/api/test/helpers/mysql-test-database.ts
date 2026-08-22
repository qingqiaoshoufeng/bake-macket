import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { composeProjectName } from '../../../../scripts/compose.mjs';

export type RootSqlExecutor = (sql: string) => string;

type MysqlTestDatabaseOptions = {
  databaseName: string;
  appUser: string;
  appHost?: string;
};

function sqlIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe MySQL identifier: ${value}`);
  }
  return `\`${value}\``;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function resolveRepositoryRoot(startDirectory = process.cwd()): string {
  const current = resolve(startDirectory);
  if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
  const parent = dirname(current);
  if (parent === current) {
    throw new Error(`Unable to find repository root from ${startDirectory}`);
  }
  return resolveRepositoryRoot(parent);
}

export function resolveMysqlContainer(
  environment: NodeJS.ProcessEnv = process.env,
  startDirectory = process.cwd(),
): string {
  if (environment.TEST_MYSQL_CONTAINER) return environment.TEST_MYSQL_CONTAINER;
  resolveRepositoryRoot(startDirectory);
  return `${composeProjectName()}-mysql-1`;
}

type DockerPortResolver = (container: string) => string;

const dockerMysqlPort: DockerPortResolver = (container) =>
  execFileSync('docker', ['port', container, '3306/tcp'], {
    encoding: 'utf8',
  });

export function resolveMysqlPort(
  environment: NodeJS.ProcessEnv = process.env,
  startDirectory = process.cwd(),
  portResolver: DockerPortResolver = dockerMysqlPort,
): number {
  const explicitPort = environment.TEST_MYSQL_PORT;
  if (explicitPort) {
    const port = Number(explicitPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error(`Invalid TEST_MYSQL_PORT: ${explicitPort}`);
    }
    return port;
  }
  const output = portResolver(
    resolveMysqlContainer(environment, startDirectory),
  ).trim();
  const port = Number(output.match(/:(\d+)$/u)?.[1]);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Unable to resolve MySQL host port from: ${output}`);
  }
  return port;
}

export function createDockerRootSqlExecutor(
  environment: NodeJS.ProcessEnv = process.env,
  startDirectory = process.cwd(),
): RootSqlExecutor {
  const container = resolveMysqlContainer(environment, startDirectory);
  const rootPassword =
    environment.TEST_MYSQL_ROOT_PASSWORD ?? 'local_root_password';
  return (sql: string) =>
    execFileSync(
      'docker',
      [
        'exec',
        container,
        'mysql',
        '-uroot',
        `-p${rootPassword}`,
        '-N',
        '-B',
        '-e',
        sql,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
}

export function mysqlTestDatabaseState(
  rootSql: RootSqlExecutor,
  options: MysqlTestDatabaseOptions,
): { schemaCount: number; grantCount: number } {
  const appHost = options.appHost ?? '%';
  const schemaCount = Number(
    rootSql(
      `SELECT COUNT(*) FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=${sqlLiteral(options.databaseName)}`,
    ),
  );
  const grantCount = Number(
    rootSql(
      `SELECT COUNT(*) FROM mysql.db WHERE Db=${sqlLiteral(options.databaseName)} AND User=${sqlLiteral(options.appUser)} AND Host=${sqlLiteral(appHost)}`,
    ),
  );
  return { schemaCount, grantCount };
}

export function cleanupMysqlTestDatabase(
  rootSql: RootSqlExecutor,
  options: MysqlTestDatabaseOptions,
): void {
  const appHost = options.appHost ?? '%';
  const database = sqlIdentifier(options.databaseName);
  const account = `${sqlLiteral(options.appUser)}@${sqlLiteral(appHost)}`;
  const { grantCount } = mysqlTestDatabaseState(rootSql, options);
  if (grantCount > 0) {
    rootSql(`REVOKE ALL PRIVILEGES ON ${database}.* FROM ${account}`);
    rootSql('FLUSH PRIVILEGES');
  }
  rootSql(`DROP DATABASE IF EXISTS ${database}`);
  const remaining = mysqlTestDatabaseState(rootSql, options);
  if (remaining.schemaCount !== 0 || remaining.grantCount !== 0) {
    throw new Error(
      `MySQL test database cleanup incomplete: ${JSON.stringify(remaining)}`,
    );
  }
}

export function provisionMysqlTestDatabase(
  rootSql: RootSqlExecutor,
  options: MysqlTestDatabaseOptions,
): () => void {
  const initial = mysqlTestDatabaseState(rootSql, options);
  if (initial.schemaCount !== 0 || initial.grantCount !== 0) {
    throw new Error(
      `MySQL test database is not clean before provisioning: ${JSON.stringify(initial)}`,
    );
  }

  const appHost = options.appHost ?? '%';
  const database = sqlIdentifier(options.databaseName);
  const account = `${sqlLiteral(options.appUser)}@${sqlLiteral(appHost)}`;
  try {
    rootSql(
      `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    rootSql(`GRANT ALL PRIVILEGES ON ${database}.* TO ${account}`);
    rootSql('FLUSH PRIVILEGES');
    return () => cleanupMysqlTestDatabase(rootSql, options);
  } catch (error) {
    cleanupMysqlTestDatabase(rootSql, options);
    throw error;
  }
}
