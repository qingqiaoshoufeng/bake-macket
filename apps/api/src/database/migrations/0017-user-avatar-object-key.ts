import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserAvatarObjectKey1718000000015 implements MigrationInterface {
  name = 'UserAvatarObjectKey1718000000015';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `users` ADD COLUMN `avatar_object_key` VARCHAR(512) NULL AFTER `avatar_url`',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `users` DROP COLUMN `avatar_object_key`',
    );
  }
}
