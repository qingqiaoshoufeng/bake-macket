import { readFileSync, readdirSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { DATABASE_MIGRATIONS, migrationsThrough } from './index.js';

const API_ROOT = resolve(__dirname, '../../..');
const MIGRATIONS_DIRECTORY = resolve(API_ROOT, 'src/database/migrations');
const MIGRATION_REGISTRY_PATH = resolve(MIGRATIONS_DIRECTORY, 'index.ts');
const MIGRATION_IMPLEMENTATION_FILE = /^(\d{4})-.*\.ts$/;
const MIGRATION_MODULE = /(?:^|\/)(\d{4})-([^/]+)\.js$/;

const typescriptFilesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'dist' ? [] : typescriptFilesUnder(path);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });

const sourceFileAt = (path: string): ts.SourceFile =>
  ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

const staticMigrationImportsAt = (
  path: string,
): Array<{ sequence: string; slug: string }> =>
  sourceFileAt(path).statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [];
    }

    const match = statement.moduleSpecifier.text.match(MIGRATION_MODULE);
    return match ? [{ sequence: match[1], slug: match[2] }] : [];
  });

const exportedMigrationClassNameAt = (path: string): string => {
  const names = sourceFileAt(path).statements.flatMap((statement) => {
    if (
      !ts.isClassDeclaration(statement) ||
      !statement.name ||
      !statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      return [];
    }
    return [statement.name.text];
  });

  expect(
    names,
    `${basename(path)} must export exactly one migration class`,
  ).toHaveLength(1);
  return names[0];
};

const dedicatedSpecMatchesMigration = (
  path: string,
  migration: { sequence: string; slug: string },
): boolean => {
  const filename = basename(path);
  if (!/\.(?:e2e-)?spec\.ts$/.test(filename)) return false;

  const specStem = filename
    .replace(/\.e2e-spec\.ts$/, '')
    .replace(/\.spec\.ts$/, '');
  return (
    specStem === `${migration.sequence}-${migration.slug}` ||
    specStem === `${migration.slug}-migration`
  );
};

const timestampOf = (name: string): number => {
  const match = name.match(/(\d+)$/);
  expect(match).not.toBeNull();
  return Number(match?.[1]);
};

describe('DATABASE_MIGRATIONS 注册表完整性', () => {
  it('统一注册十二项迁移，并以云打印机迁移作为当前尾项', () => {
    expect(DATABASE_MIGRATIONS).toHaveLength(12);
    expect(DATABASE_MIGRATIONS.at(-1)?.name).toBe('CloudPrinters1718000000010');
  });

  it('与磁盘上的迁移实现文件按四位编号和导出类一一对应', () => {
    const diskMigrations = readdirSync(MIGRATIONS_DIRECTORY, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .flatMap((entry) => {
        const match = entry.name.match(MIGRATION_IMPLEMENTATION_FILE);
        if (!match || entry.name.endsWith('.spec.ts')) return [];
        const path = resolve(MIGRATIONS_DIRECTORY, entry.name);
        return [
          {
            sequence: match[1],
            className: exportedMigrationClassNameAt(path),
          },
        ];
      })
      .sort((left, right) => left.sequence.localeCompare(right.sequence));
    const registeredClassNames = DATABASE_MIGRATIONS.map(
      (migration) => migration.name,
    );

    expect(diskMigrations.map(({ sequence }) => sequence)).toEqual(
      diskMigrations.map((_, index) => String(index + 1).padStart(4, '0')),
    );
    expect(registeredClassNames).toEqual(
      diskMigrations.map(({ className }) => className),
    );
    expect(new Set(registeredClassNames).size).toBe(
      registeredClassNames.length,
    );
  });

  it('除已知双历史 legacy collision 外按 timestamp 严格递增注册迁移', () => {
    const names = DATABASE_MIGRATIONS.map((migration) => migration.name);
    const timestamps = names.map(timestampOf);
    const collisions = names.flatMap((name, index) => {
      if (index === 0 || timestamps[index] !== timestamps[index - 1]) return [];
      return [[names[index - 1], name]] as const;
    });

    expect(collisions).toEqual([
      ['HomepageMultipleDrafts1718000000009', 'UserAdminIdentity1718000000009'],
    ]);
    expect(
      timestamps.every((timestamp, index) => {
        if (index === 0) return true;
        const previous = timestamps[index - 1];
        return (
          timestamp > previous ||
          (names[index - 1] === 'HomepageMultipleDrafts1718000000009' &&
            names[index] === 'UserAdminIdentity1718000000009' &&
            timestamp === previous)
        );
      }),
    ).toBe(true);
  });
});

describe('迁移实现静态 import 范围', () => {
  it('仅允许注册表导入全部迁移，以及专项 spec 导入对应单个迁移', () => {
    const offenders = typescriptFilesUnder(API_ROOT).flatMap((path) => {
      if (path === MIGRATION_REGISTRY_PATH) return [];

      const migrationImports = staticMigrationImportsAt(path);
      if (migrationImports.length === 0) return [];
      const isDedicatedSpec =
        migrationImports.length === 1 &&
        dedicatedSpecMatchesMigration(path, migrationImports[0]);
      return isDedicatedSpec
        ? []
        : [relative(API_ROOT, path).replaceAll('\\', '/')];
    });

    expect(offenders).toEqual([]);
  });
});

describe('migrationsThrough', () => {
  it('按迁移类名返回包含该迁移的历史切片', () => {
    expect(
      migrationsThrough('MembershipAndOrderPricing1718000000004').at(-1)?.name,
    ).toBe('MembershipAndOrderPricing1718000000004');
    expect(
      migrationsThrough('DefaultMembershipLevels1718000000006').at(-1)?.name,
    ).toBe('DefaultMembershipLevels1718000000006');
  });

  it('找不到迁移类名时抛错', () => {
    expect(() => migrationsThrough('MissingMigration')).toThrow(
      'Migration not found: MissingMigration',
    );
  });

  it('迁移类名重复时抛错', () => {
    const duplicatedMigrations = [
      DATABASE_MIGRATIONS[0],
      DATABASE_MIGRATIONS[0],
    ] as const;

    expect(() =>
      migrationsThrough(DATABASE_MIGRATIONS[0].name, duplicatedMigrations),
    ).toThrow(
      `Migration registered more than once: ${DATABASE_MIGRATIONS[0].name}`,
    );
  });
});
