import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { composeProjectName } from '../../../../scripts/compose.mjs';
import {
  provisionMysqlTestDatabase,
  resolveMysqlContainer,
  resolveMysqlPort,
  resolveRepositoryRoot,
} from './mysql-test-database.js';

const repositoryRoot = resolveRepositoryRoot(process.cwd());
const apiDirectory = join(repositoryRoot, 'apps/api');

describe('MySQL test database helpers', () => {
  it('resolves the repository root from the API working directory', () => {
    expect(resolveRepositoryRoot(apiDirectory)).toBe(repositoryRoot);
  });

  it('derives the compose MySQL container from the repository branch', () => {
    const branch =
      execFileSync('git', ['-C', repositoryRoot, 'branch', '--show-current'], {
        encoding: 'utf8',
      }).trim() || 'detached';

    expect(resolveMysqlContainer({}, apiDirectory)).toBe(
      `${composeProjectName(branch)}-mysql-1`,
    );
  });

  it('honors an explicit container override', () => {
    expect(
      resolveMysqlContainer(
        { TEST_MYSQL_CONTAINER: 'explicit-mysql-container' },
        apiDirectory,
      ),
    ).toBe('explicit-mysql-container');
  });

  it('uses an explicit MySQL port before inspecting the selected container', () => {
    expect(
      resolveMysqlPort(
        { TEST_MYSQL_PORT: '45555' },
        apiDirectory,
        () => '43306',
      ),
    ).toBe(45555);
  });

  it('derives the host port from the same selected container used for root SQL', () => {
    expect(
      resolveMysqlPort({}, apiDirectory, (container) => {
        expect(container).toBe(resolveMysqlContainer({}, apiDirectory));
        return '127.0.0.1:43306\n';
      }),
    ).toBe(43306);
  });

  it('drops a created schema without attempting REVOKE when GRANT fails', () => {
    let schemaCount = 0;
    const statements: string[] = [];
    const rootSql = (sql: string): string => {
      statements.push(sql);
      if (sql.includes('INFORMATION_SCHEMA.SCHEMATA'))
        return String(schemaCount);
      if (sql.includes('FROM mysql.db')) return '0';
      if (sql.startsWith('CREATE DATABASE')) {
        schemaCount = 1;
        return '';
      }
      if (sql.startsWith('GRANT ALL PRIVILEGES')) {
        throw new Error('forced grant failure');
      }
      if (sql.startsWith('DROP DATABASE')) {
        schemaCount = 0;
        return '';
      }
      return '';
    };

    expect(() =>
      provisionMysqlTestDatabase(rootSql, {
        databaseName: 'bake_mall_cleanup_probe',
        appUser: 'bake_app',
      }),
    ).toThrow('forced grant failure');
    expect(statements.some((sql) => sql.startsWith('DROP DATABASE'))).toBe(
      true,
    );
    expect(statements.some((sql) => sql.startsWith('REVOKE'))).toBe(false);
    expect(schemaCount).toBe(0);
  });
});
