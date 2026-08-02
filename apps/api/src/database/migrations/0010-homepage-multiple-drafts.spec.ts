import { describe, expect, it, vi } from 'vitest';

import { HomepageMultipleDrafts1718000000009 } from './0010-homepage-multiple-drafts.js';

const statementsOf = (query: ReturnType<typeof vi.fn>): string[] =>
  query.mock.calls.map(([sql]) => String(sql));

const indexOfStatement = (
  statements: readonly string[],
  pattern: string,
): number => statements.findIndex((statement) => statement.includes(pattern));

describe('HomepageMultipleDrafts1718000000009', () => {
  it('creates per-page drafts, migrates the current homepage draft, and only then removes legacy draft columns', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new HomepageMultipleDrafts1718000000009().up({ query } as never);

    const statements = statementsOf(query);
    const sql = statements.join('\n');
    expect(sql).toContain('CREATE TABLE `homepage_drafts`');
    expect(sql).toContain('`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    expect(sql).toContain('`homepage_page_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain('`name` VARCHAR(120) NOT NULL');
    expect(sql).toContain(
      '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    );
    expect(sql).toContain(
      'UNIQUE INDEX `uniq_homepage_drafts_page_name` (`homepage_page_id`, `name`)',
    );
    expect(sql).toContain(
      'INDEX `idx_homepage_drafts_page_updated` (`homepage_page_id`, `updated_at`, `id`)',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_homepage_drafts_page` FOREIGN KEY (`homepage_page_id`) REFERENCES `homepage_pages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_homepage_drafts_updated_admin` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
    );
    expect(sql).toContain('DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

    const copyDraft = statements.find((statement) =>
      statement.startsWith('INSERT INTO `homepage_drafts`'),
    );
    expect(copyDraft).toContain("'当前首页'");
    expect(copyDraft).toContain('`draft_config`');
    expect(copyDraft).toContain('`version`');
    expect(copyDraft).toContain('`draft_updated_by_admin_id`');
    expect(copyDraft).toContain('`draft_updated_at`');

    const attachPublishedDraft = statements.find((statement) =>
      statement.startsWith('UPDATE `homepage_pages` page'),
    );
    expect(attachPublishedDraft).toContain(
      'page.`published_draft_id` = draft.`id`',
    );
    expect(attachPublishedDraft).toContain(
      'page.`published_draft_version` = draft.`version`',
    );
    expect(attachPublishedDraft).toContain(
      'page.`published_config` IS NOT NULL',
    );
    expect(sql).toContain(
      'ADD COLUMN `published_draft_id` BIGINT UNSIGNED NULL',
    );
    expect(sql).toContain(
      'ADD COLUMN `published_draft_version` INT UNSIGNED NULL',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_homepage_pages_published_draft` FOREIGN KEY (`published_draft_id`) REFERENCES `homepage_drafts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    );

    expect(
      indexOfStatement(statements, 'INSERT INTO `homepage_drafts`'),
    ).toBeLessThan(indexOfStatement(statements, 'DROP COLUMN `draft_config`'));
    expect(
      indexOfStatement(statements, 'UPDATE `homepage_pages` page'),
    ).toBeLessThan(indexOfStatement(statements, 'DROP COLUMN `version`'));
    expect(
      indexOfStatement(
        statements,
        'DROP FOREIGN KEY `fk_homepage_draft_admin`',
      ),
    ).toBeLessThan(
      indexOfStatement(statements, 'DROP COLUMN `draft_updated_by_admin_id`'),
    );
  });

  it('restores legacy columns and their data before removing the published-source relation and drafts table', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new HomepageMultipleDrafts1718000000009().down({ query } as never);

    const statements = statementsOf(query);
    const sql = statements.join('\n');
    expect(sql).toContain('ADD COLUMN `draft_config` JSON NULL');
    expect(sql).toContain(
      'ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 1',
    );
    expect(sql).toContain(
      'ADD COLUMN `draft_updated_by_admin_id` BIGINT UNSIGNED NULL',
    );
    expect(sql).toContain('ADD COLUMN `draft_updated_at` DATETIME NULL');
    expect(sql).toContain(
      'COALESCE(`published_draft`.`id`, `first_draft`.`id`)',
    );
    expect(sql).toContain('MODIFY COLUMN `draft_config` JSON NOT NULL');
    expect(sql).toContain(
      'ADD CONSTRAINT `fk_homepage_draft_admin` FOREIGN KEY (`draft_updated_by_admin_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
    );

    const restoreData = indexOfStatement(
      statements,
      'UPDATE `homepage_pages` page',
    );
    const dropSourceForeignKey = indexOfStatement(
      statements,
      'DROP FOREIGN KEY `fk_homepage_pages_published_draft`',
    );
    const dropDrafts = indexOfStatement(
      statements,
      'DROP TABLE `homepage_drafts`',
    );
    expect(restoreData).toBeGreaterThanOrEqual(0);
    expect(restoreData).toBeLessThan(dropSourceForeignKey);
    expect(dropSourceForeignKey).toBeLessThan(dropDrafts);
    expect(
      indexOfStatement(statements, 'DROP COLUMN `published_draft_id`'),
    ).toBeLessThan(dropDrafts);
  });
});
