import type { MigrationInterface, QueryRunner } from 'typeorm';

const VALID_PHONE_PATTERN = '^1[0-9]{10}$';

const hasColumn = async (
  queryRunner: QueryRunner,
  tableName: string,
  columnName: string,
): Promise<boolean> => {
  const rows = await queryRunner.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  return Number(rows[0]?.count) > 0;
};

const hasIndex = async (
  queryRunner: QueryRunner,
  tableName: string,
  indexName: string,
): Promise<boolean> => {
  const rows = await queryRunner.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName],
  );
  return Number(rows[0]?.count) > 0;
};

const hasCheckConstraint = async (
  queryRunner: QueryRunner,
  tableName: string,
  constraintName: string,
): Promise<boolean> => {
  const rows = await queryRunner.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'CHECK'`,
    [tableName, constraintName],
  );
  return Number(rows[0]?.count) > 0;
};

/** Separates customer fulfillment contact data from identity and admin login phones. */
export class OrderContactAndAdminLoginPhone1718000000013 implements MigrationInterface {
  name = 'OrderContactAndAdminLoginPhone1718000000013';
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await hasColumn(queryRunner, 'users', 'order_contact_phone'))) {
      await queryRunner.query(
        'ALTER TABLE `users` ADD COLUMN `order_contact_phone` VARCHAR(32) NULL AFTER `phone_verified`',
      );
    }
    if (
      !(await hasColumn(queryRunner, 'users', 'order_contact_phone_version'))
    ) {
      await queryRunner.query(
        'ALTER TABLE `users` ADD COLUMN `order_contact_phone_version` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `order_contact_phone`',
      );
    }

    if (!(await hasColumn(queryRunner, 'admin_users', 'login_phone'))) {
      await queryRunner.query(
        'ALTER TABLE `admin_users` ADD COLUMN `login_phone` VARCHAR(32) NULL AFTER `role`',
      );
    }

    await queryRunner.query(
      `UPDATE \`users\`
       SET \`order_contact_phone\` = \`phone\`, \`order_contact_phone_version\` = 1
       WHERE \`order_contact_phone\` IS NULL
         AND \`phone\` REGEXP ?`,
      [VALID_PHONE_PATTERN],
    );

    await queryRunner.query(
      `UPDATE \`admin_users\` operator
       INNER JOIN \`users\` linked_user ON linked_user.id = operator.linked_user_id
       SET operator.login_phone = linked_user.phone
       WHERE operator.role = 'OPERATOR'
         AND operator.login_phone IS NULL
         AND linked_user.phone REGEXP ?`,
      [VALID_PHONE_PATTERN],
    );

    await queryRunner.query(
      `UPDATE \`admin_users\`
       SET \`is_active\` = 0, \`token_version\` = \`token_version\` + 1
       WHERE \`role\` = 'OPERATOR'
         AND \`login_phone\` IS NULL
         AND \`is_active\` = 1`,
    );

    if (
      !(await hasIndex(
        queryRunner,
        'admin_users',
        'uniq_admin_users_login_phone',
      ))
    ) {
      await queryRunner.query(
        'ALTER TABLE `admin_users` ADD UNIQUE INDEX `uniq_admin_users_login_phone` (`login_phone`)',
      );
    }

    if (
      await hasCheckConstraint(
        queryRunner,
        'admin_users',
        'chk_admin_users_role_identity',
      )
    ) {
      await queryRunner.query(
        'ALTER TABLE `admin_users` DROP CHECK `chk_admin_users_role_identity`',
      );
    }
    if (
      !(await hasCheckConstraint(
        queryRunner,
        'admin_users',
        'chk_admin_users_role_identity',
      ))
    ) {
      await queryRunner.query(
        "ALTER TABLE `admin_users` ADD CONSTRAINT `chk_admin_users_role_identity` CHECK ((`role` = 'SUPER_ADMIN' AND `username` IS NOT NULL AND `login_phone` IS NULL AND `linked_user_id` IS NULL) OR (`role` = 'OPERATOR' AND `username` IS NULL AND `linked_user_id` IS NOT NULL AND (`login_phone` IS NOT NULL OR `is_active` = 0)))",
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const hasOrderContactPhone = await hasColumn(
      queryRunner,
      'users',
      'order_contact_phone',
    );
    const hasOrderContactPhoneVersion = await hasColumn(
      queryRunner,
      'users',
      'order_contact_phone_version',
    );
    const userConditions = [
      ...(hasOrderContactPhone ? ['`order_contact_phone` IS NOT NULL'] : []),
      ...(hasOrderContactPhoneVersion
        ? ['`order_contact_phone_version` <> 0']
        : []),
    ];
    const usersWithNewData =
      userConditions.length === 0
        ? false
        : Number(
            (
              await queryRunner.query(
                `SELECT EXISTS(SELECT 1 FROM \`users\` WHERE ${userConditions.join(' OR ')} LIMIT 1) AS has_data`,
              )
            )[0]?.has_data,
          ) === 1;
    const hasLoginPhone = await hasColumn(
      queryRunner,
      'admin_users',
      'login_phone',
    );
    const adminsWithNewData = hasLoginPhone
      ? Number(
          (
            await queryRunner.query(
              "SELECT EXISTS(SELECT 1 FROM `admin_users` WHERE `login_phone` IS NOT NULL OR (`role` = 'OPERATOR' AND `is_active` = 0) LIMIT 1) AS has_data",
            )
          )[0]?.has_data,
        ) === 1
      : false;
    if (usersWithNewData || adminsWithNewData) {
      throw new Error(
        'OrderContactAndAdminLoginPhone1718000000013 down refused: new contact or admin login data exists',
      );
    }

    if (
      await hasCheckConstraint(
        queryRunner,
        'admin_users',
        'chk_admin_users_role_identity',
      )
    ) {
      await queryRunner.query(
        'ALTER TABLE `admin_users` DROP CHECK `chk_admin_users_role_identity`',
      );
    }
    await queryRunner.query(
      "ALTER TABLE `admin_users` ADD CONSTRAINT `chk_admin_users_role_identity` CHECK ((`role` = 'SUPER_ADMIN' AND `username` IS NOT NULL AND `linked_user_id` IS NULL) OR (`role` = 'OPERATOR' AND `username` IS NULL AND `linked_user_id` IS NOT NULL))",
    );
    if (
      await hasIndex(queryRunner, 'admin_users', 'uniq_admin_users_login_phone')
    ) {
      await queryRunner.query(
        'ALTER TABLE `admin_users` DROP INDEX `uniq_admin_users_login_phone`',
      );
    }
    if (await hasColumn(queryRunner, 'admin_users', 'login_phone')) {
      await queryRunner.query(
        'ALTER TABLE `admin_users` DROP COLUMN `login_phone`',
      );
    }
    if (await hasColumn(queryRunner, 'users', 'order_contact_phone_version')) {
      await queryRunner.query(
        'ALTER TABLE `users` DROP COLUMN `order_contact_phone_version`',
      );
    }
    if (await hasColumn(queryRunner, 'users', 'order_contact_phone')) {
      await queryRunner.query(
        'ALTER TABLE `users` DROP COLUMN `order_contact_phone`',
      );
    }
  }
}
