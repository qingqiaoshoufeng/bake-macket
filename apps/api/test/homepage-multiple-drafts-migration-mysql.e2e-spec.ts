import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { DataSource, type MigrationInterface } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as entities from '../src/database/entities/index.js';
import { migrationsThrough } from '../src/database/migrations/index.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_homepage_migration_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const MIGRATIONS_TO_0009 = migrationsThrough(
  'HomepagePages1718000000008',
) as Array<new () => MigrationInterface>;
const ALL_MIGRATIONS = migrationsThrough(
  'HomepageMultipleDrafts1718000000009',
) as Array<new () => MigrationInterface>;
const DRAFT_UPDATED_AT = '2026-07-31 08:04:00';
const PUBLISHED_AT = '2026-07-30 07:03:00';

type AdminRow = { id: string };
type MigratedHomepageRow = {
  draft_id: string;
  draft_marker: string;
  draft_version: number;
  draft_updated_by_admin_id: string;
  draft_updated_at: string;
  live_marker: string;
  published_version: number;
  published_by_admin_id: string;
  published_at: string;
  published_draft_id: string;
  published_draft_version: number;
};
type RestoredHomepageRow = {
  draft_marker: string;
  version: number;
  draft_updated_by_admin_id: string;
  draft_updated_at: string;
  live_marker: string;
  published_version: number;
  published_by_admin_id: string;
  published_at: string;
};
type ColumnRow = { COLUMN_NAME: string };
type CountRow = { count: string | number };

function createDataSource(
  migrations: Array<new () => MigrationInterface>,
): DataSource {
  return new DataSource({
    type: 'mysql',
    host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_MYSQL_PORT ?? 44306),
    database: DATABASE_NAME,
    username: APP_USER,
    password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
    charset: 'utf8mb4',
    timezone: 'Z',
    synchronize: false,
    entities: Object.values(entities),
    migrations,
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
  });
}

async function homepageColumns(source: DataSource): Promise<string[]> {
  const rows = await source.query<ColumnRow[]>(
    `SELECT \`COLUMN_NAME\`
       FROM \`INFORMATION_SCHEMA\`.\`COLUMNS\`
      WHERE \`TABLE_SCHEMA\` = ? AND \`TABLE_NAME\` = 'homepage_pages'
      ORDER BY \`ORDINAL_POSITION\``,
    [DATABASE_NAME],
  );
  return rows.map(({ COLUMN_NAME }) => COLUMN_NAME);
}

async function tableCount(source: DataSource): Promise<number> {
  const [row] = await source.query<CountRow[]>(
    `SELECT COUNT(*) AS \`count\`
       FROM \`INFORMATION_SCHEMA\`.\`TABLES\`
      WHERE \`TABLE_SCHEMA\` = ? AND \`TABLE_NAME\` = 'homepage_drafts'`,
    [DATABASE_NAME],
  );
  return Number(row?.count ?? 0);
}

describe.sequential('homepage multiple drafts migration on MySQL', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let source: DataSource | undefined;
  let draftAdminId = '';
  let publishedAdminId = '';

  beforeAll(async () => {
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      source = createDataSource(MIGRATIONS_TO_0009);
      await source.initialize();
      await source.runMigrations();

      await source.query(
        `INSERT INTO \`admin_users\` (\`username\`, \`password_hash\`)
         VALUES ('migration-draft-admin', 'test-only'),
                ('migration-published-admin', 'test-only')`,
      );
      const [draftAdmin] = await source.query<AdminRow[]>(
        `SELECT \`id\` FROM \`admin_users\` WHERE \`username\` = 'migration-draft-admin'`,
      );
      const [publishedAdmin] = await source.query<AdminRow[]>(
        `SELECT \`id\` FROM \`admin_users\` WHERE \`username\` = 'migration-published-admin'`,
      );
      if (!draftAdmin || !publishedAdmin) {
        throw new Error('Migration admin fixtures are unavailable');
      }
      draftAdminId = String(draftAdmin.id);
      publishedAdminId = String(publishedAdmin.id);

      await source.query(
        `UPDATE \`homepage_pages\`
            SET \`draft_config\` = CAST(? AS JSON),
                \`published_config\` = CAST(? AS JSON),
                \`version\` = 4,
                \`published_version\` = 3,
                \`draft_updated_by_admin_id\` = ?,
                \`draft_updated_at\` = ?,
                \`published_by_admin_id\` = ?,
                \`published_at\` = ?
          WHERE \`page_key\` = 'HOME'`,
        [
          JSON.stringify({ marker: 'draft-v4' }),
          JSON.stringify({ marker: 'live-v3' }),
          draftAdminId,
          DRAFT_UPDATED_AT,
          publishedAdminId,
          PUBLISHED_AT,
        ],
      );
    } catch (error) {
      try {
        if (source?.isInitialized) await source.destroy();
      } finally {
        cleanupDatabase?.();
        cleanupDatabase = undefined;
      }
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    try {
      if (source?.isInitialized) await source.destroy();
    } finally {
      cleanupDatabase?.();
      cleanupDatabase = undefined;
    }
    expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
      schemaCount: 0,
      grantCount: 0,
    });
  });

  it('preserves different draft and live versions through up and down', async () => {
    await source!.destroy();
    source = createDataSource(ALL_MIGRATIONS);
    await source.initialize();

    const applied = await source.runMigrations();
    expect(applied.map(({ name }) => name)).toEqual([
      'HomepageMultipleDrafts1718000000009',
    ]);

    const [migrated] = await source.query<MigratedHomepageRow[]>(
      `SELECT
         CAST(draft.\`id\` AS CHAR) AS \`draft_id\`,
         JSON_UNQUOTE(JSON_EXTRACT(draft.\`draft_config\`, '$.marker')) AS \`draft_marker\`,
         draft.\`version\` AS \`draft_version\`,
         CAST(draft.\`updated_by_admin_id\` AS CHAR) AS \`draft_updated_by_admin_id\`,
         DATE_FORMAT(draft.\`updated_at\`, '%Y-%m-%d %H:%i:%s') AS \`draft_updated_at\`,
         JSON_UNQUOTE(JSON_EXTRACT(page.\`published_config\`, '$.marker')) AS \`live_marker\`,
         page.\`published_version\` AS \`published_version\`,
         CAST(page.\`published_by_admin_id\` AS CHAR) AS \`published_by_admin_id\`,
         DATE_FORMAT(page.\`published_at\`, '%Y-%m-%d %H:%i:%s') AS \`published_at\`,
         CAST(page.\`published_draft_id\` AS CHAR) AS \`published_draft_id\`,
         page.\`published_draft_version\` AS \`published_draft_version\`
       FROM \`homepage_pages\` page
       INNER JOIN \`homepage_drafts\` draft
         ON draft.\`homepage_page_id\` = page.\`id\`
      WHERE page.\`page_key\` = 'HOME'`,
    );

    expect(migrated).toEqual({
      draft_id: expect.any(String),
      draft_marker: 'draft-v4',
      draft_version: 4,
      draft_updated_by_admin_id: draftAdminId,
      draft_updated_at: DRAFT_UPDATED_AT,
      live_marker: 'live-v3',
      published_version: 3,
      published_by_admin_id: publishedAdminId,
      published_at: PUBLISHED_AT,
      published_draft_id: migrated?.draft_id,
      published_draft_version: 3,
    });
    expect(await homepageColumns(source)).not.toEqual(
      expect.arrayContaining([
        'draft_config',
        'version',
        'draft_updated_by_admin_id',
        'draft_updated_at',
      ]),
    );
    await expect(source.runMigrations()).resolves.toEqual([]);

    await source.undoLastMigration({ transaction: 'each' });

    const [restored] = await source.query<RestoredHomepageRow[]>(
      `SELECT
         JSON_UNQUOTE(JSON_EXTRACT(\`draft_config\`, '$.marker')) AS \`draft_marker\`,
         \`version\`,
         CAST(\`draft_updated_by_admin_id\` AS CHAR) AS \`draft_updated_by_admin_id\`,
         DATE_FORMAT(\`draft_updated_at\`, '%Y-%m-%d %H:%i:%s') AS \`draft_updated_at\`,
         JSON_UNQUOTE(JSON_EXTRACT(\`published_config\`, '$.marker')) AS \`live_marker\`,
         \`published_version\`,
         CAST(\`published_by_admin_id\` AS CHAR) AS \`published_by_admin_id\`,
         DATE_FORMAT(\`published_at\`, '%Y-%m-%d %H:%i:%s') AS \`published_at\`
       FROM \`homepage_pages\`
      WHERE \`page_key\` = 'HOME'`,
    );
    expect(restored).toEqual({
      draft_marker: 'draft-v4',
      version: 4,
      draft_updated_by_admin_id: draftAdminId,
      draft_updated_at: DRAFT_UPDATED_AT,
      live_marker: 'live-v3',
      published_version: 3,
      published_by_admin_id: publishedAdminId,
      published_at: PUBLISHED_AT,
    });
    expect(await homepageColumns(source)).not.toEqual(
      expect.arrayContaining(['published_draft_id', 'published_draft_version']),
    );
    await expect(tableCount(source)).resolves.toBe(0);
  }, 60_000);
});
