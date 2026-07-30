import type { MigrationInterface, QueryRunner } from 'typeorm';

const INITIAL_DRAFT = {
  schemaVersion: 1,
  hero: {
    id: 'hero',
    type: 'HERO_CAROUSEL',
    enabled: true,
    autoplayMs: 5000,
    slides: [],
  },
  customerService: {
    id: 'customer-service',
    type: 'CUSTOMER_SERVICE',
    enabled: true,
    title: '联系客服',
    description: '如需定制或帮助，欢迎联系我们',
    phone: '',
    serviceHours: '',
    wechatQrCode: null,
  },
  shortcutGrid: {
    id: 'shortcut-grid',
    type: 'SHORTCUT_GRID',
    enabled: true,
    title: '快捷入口',
    layout: 4,
    items: [],
  },
  imageBlocks: [],
};

export class HomepagePages1718000000008 implements MigrationInterface {
  name = 'HomepagePages1718000000008';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`homepage_pages\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`page_key\` VARCHAR(32) NOT NULL,
      \`draft_config\` JSON NOT NULL,
      \`published_config\` JSON NULL,
      \`version\` INT UNSIGNED NOT NULL DEFAULT 1,
      \`published_version\` INT UNSIGNED NULL,
      \`draft_updated_by_admin_id\` BIGINT UNSIGNED NULL,
      \`draft_updated_at\` DATETIME NULL,
      \`published_by_admin_id\` BIGINT UNSIGNED NULL,
      \`published_at\` DATETIME NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE INDEX \`uniq_homepage_pages_page_key\` (\`page_key\`),
      CONSTRAINT \`fk_homepage_draft_admin\` FOREIGN KEY (\`draft_updated_by_admin_id\`) REFERENCES \`admin_users\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT \`fk_homepage_published_admin\` FOREIGN KEY (\`published_by_admin_id\`) REFERENCES \`admin_users\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(
      'INSERT INTO `homepage_pages` (`page_key`, `draft_config`) VALUES (?, CAST(? AS JSON))',
      ['HOME', JSON.stringify(INITIAL_DRAFT)],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `homepage_pages`');
  }
}
