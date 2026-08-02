import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HomepageMultipleDrafts1718000000009 implements MigrationInterface {
  name = 'HomepageMultipleDrafts1718000000009';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`homepage_drafts\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`homepage_page_id\` BIGINT UNSIGNED NOT NULL,
      \`name\` VARCHAR(120) NOT NULL,
      \`draft_config\` JSON NOT NULL,
      \`version\` INT UNSIGNED NOT NULL DEFAULT 1,
      \`updated_by_admin_id\` BIGINT UNSIGNED NULL,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE INDEX \`uniq_homepage_drafts_page_name\` (\`homepage_page_id\`, \`name\`),
      INDEX \`idx_homepage_drafts_page_updated\` (\`homepage_page_id\`, \`updated_at\`, \`id\`),
      CONSTRAINT \`fk_homepage_drafts_page\` FOREIGN KEY (\`homepage_page_id\`) REFERENCES \`homepage_pages\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`fk_homepage_drafts_updated_admin\` FOREIGN KEY (\`updated_by_admin_id\`) REFERENCES \`admin_users\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await queryRunner.query(`INSERT INTO \`homepage_drafts\` (
      \`homepage_page_id\`,
      \`name\`,
      \`draft_config\`,
      \`version\`,
      \`updated_by_admin_id\`,
      \`updated_at\`,
      \`created_at\`
    )
    SELECT
      \`id\`,
      '当前首页',
      \`draft_config\`,
      \`version\`,
      \`draft_updated_by_admin_id\`,
      COALESCE(\`draft_updated_at\`, \`updated_at\`, \`created_at\`),
      \`created_at\`
    FROM \`homepage_pages\``);

    await queryRunner.query(`ALTER TABLE \`homepage_pages\`
      ADD COLUMN \`published_draft_id\` BIGINT UNSIGNED NULL,
      ADD COLUMN \`published_draft_version\` INT UNSIGNED NULL`);

    await queryRunner.query(`UPDATE \`homepage_pages\` page
      INNER JOIN \`homepage_drafts\` draft
        ON draft.\`homepage_page_id\` = page.\`id\`
        AND draft.\`name\` = '当前首页'
      SET page.\`published_draft_id\` = draft.\`id\`,
          page.\`published_draft_version\` = draft.\`version\`
      WHERE page.\`published_config\` IS NOT NULL`);

    await queryRunner.query(`ALTER TABLE \`homepage_pages\`
      ADD CONSTRAINT \`fk_homepage_pages_published_draft\` FOREIGN KEY (\`published_draft_id\`) REFERENCES \`homepage_drafts\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE`);

    await queryRunner.query(
      'ALTER TABLE `homepage_pages` DROP FOREIGN KEY `fk_homepage_draft_admin`',
    );
    await queryRunner.query(`ALTER TABLE \`homepage_pages\`
      DROP COLUMN \`draft_updated_at\`,
      DROP COLUMN \`draft_updated_by_admin_id\`,
      DROP COLUMN \`version\`,
      DROP COLUMN \`draft_config\``);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`homepage_pages\`
      ADD COLUMN \`draft_config\` JSON NULL,
      ADD COLUMN \`version\` INT UNSIGNED NOT NULL DEFAULT 1,
      ADD COLUMN \`draft_updated_by_admin_id\` BIGINT UNSIGNED NULL,
      ADD COLUMN \`draft_updated_at\` DATETIME NULL`);

    await queryRunner.query(`UPDATE \`homepage_pages\` page
      LEFT JOIN \`homepage_drafts\` published_draft
        ON published_draft.\`id\` = page.\`published_draft_id\`
      LEFT JOIN (
        SELECT draft.\`homepage_page_id\`, draft.\`id\`
        FROM \`homepage_drafts\` draft
        INNER JOIN (
          SELECT \`homepage_page_id\`, MIN(\`id\`) AS \`id\`
          FROM \`homepage_drafts\`
          GROUP BY \`homepage_page_id\`
        ) first_draft_ids
          ON first_draft_ids.\`id\` = draft.\`id\`
      ) first_draft_ref
        ON first_draft_ref.\`homepage_page_id\` = page.\`id\`
      LEFT JOIN \`homepage_drafts\` first_draft
        ON first_draft.\`id\` = first_draft_ref.\`id\`
      SET page.\`draft_config\` = COALESCE(\`published_draft\`.\`draft_config\`, \`first_draft\`.\`draft_config\`),
          page.\`version\` = COALESCE(\`published_draft\`.\`version\`, \`first_draft\`.\`version\`, 1),
          page.\`draft_updated_by_admin_id\` = COALESCE(\`published_draft\`.\`updated_by_admin_id\`, \`first_draft\`.\`updated_by_admin_id\`),
          page.\`draft_updated_at\` = COALESCE(\`published_draft\`.\`updated_at\`, \`first_draft\`.\`updated_at\`)
      WHERE COALESCE(\`published_draft\`.\`id\`, \`first_draft\`.\`id\`) IS NOT NULL`);

    await queryRunner.query(
      'ALTER TABLE `homepage_pages` MODIFY COLUMN `draft_config` JSON NOT NULL',
    );
    await queryRunner.query(`ALTER TABLE \`homepage_pages\`
      ADD CONSTRAINT \`fk_homepage_draft_admin\` FOREIGN KEY (\`draft_updated_by_admin_id\`) REFERENCES \`admin_users\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE`);

    await queryRunner.query(
      'ALTER TABLE `homepage_pages` DROP FOREIGN KEY `fk_homepage_pages_published_draft`',
    );
    await queryRunner.query(`ALTER TABLE \`homepage_pages\`
      DROP COLUMN \`published_draft_version\`,
      DROP COLUMN \`published_draft_id\``);
    await queryRunner.query('DROP TABLE `homepage_drafts`');
  }
}
