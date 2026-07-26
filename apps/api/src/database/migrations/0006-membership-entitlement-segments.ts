import { MembershipEntitlementSegmentKind } from '@bake-mall/contracts';
import type { MigrationInterface, QueryRunner } from 'typeorm';

type ViolationRow = { id: string | number };
type MembershipSnapshotRow = {
  checksum: string | number;
  row_count: string | number;
};
const asViolationRows = (rows: unknown): ViolationRow[] =>
  Array.isArray(rows) ? (rows as ViolationRow[]) : [];

function assertNoViolation(rows: unknown, category: string): void {
  const violation = asViolationRows(rows)[0];
  if (violation) {
    throw new Error(
      `Membership entitlement migration ${category} failed for purchase/segment ${String(violation.id)}`,
    );
  }
}

const asMembershipSnapshot = (
  rows: unknown,
): MembershipSnapshotRow | undefined =>
  Array.isArray(rows)
    ? (rows[0] as MembershipSnapshotRow | undefined)
    : undefined;

function snapshotsMatch(
  before: MembershipSnapshotRow | undefined,
  after: MembershipSnapshotRow | undefined,
): boolean {
  if (!before && !after) return true;
  if (!before || !after) return false;
  return (
    String(before.row_count) === String(after.row_count) &&
    String(before.checksum) === String(after.checksum)
  );
}

const MEMBERSHIP_SNAPSHOT_SQL = (
  stage: 'preflight' | 'postflight',
): string => `SELECT
      COUNT(*) AS \`row_count\`,
      COALESCE(SUM(CRC32(CONCAT_WS('|',
        \`id\`, \`user_id\`, \`purchase_order_id\`, \`membership_level_id\`,
        \`level_code\`, \`level_name\`, \`level_rank\`, \`discount_basis_points\`,
        CAST(\`benefits\` AS CHAR), \`theme\`, \`badge_text\`, \`starts_at\`,
        \`ends_at\`, COALESCE(\`previous_membership_id\`, 'NULL'), \`status\`,
        \`created_at\`, \`updated_at\`
      ))), 0) AS \`checksum\`
    FROM \`user_memberships\`
    /* ${stage}:membership-${stage === 'preflight' ? 'snapshot' : 'unchanged'} */`;

/** Adds immutable entitlement segments and backfills only proven historical purchases. */
export class MembershipEntitlementSegments1718000000005 implements MigrationInterface {
  name = 'MembershipEntitlementSegments1718000000005';

  async up(queryRunner: QueryRunner): Promise<void> {
    const invalidPurchaseStates = await queryRunner.query(`SELECT
        /* preflight:purchase-state-shape */
        p.\`id\`, COUNT(membership.\`id\`) AS \`membership_count\`
      FROM \`membership_purchase_orders\` p
      LEFT JOIN \`user_memberships\` membership
        ON membership.\`purchase_order_id\` = p.\`id\`
      GROUP BY p.\`id\`, p.\`status\`, p.\`payment_status\`, p.\`paid_at\`, p.\`voided_at\`
      HAVING NOT (
        (p.\`status\` = 'PENDING'
          AND p.\`payment_status\` = 'PENDING'
          AND p.\`paid_at\` IS NULL
          AND p.\`voided_at\` IS NULL
          AND \`membership_count\` = 0)
        OR (p.\`status\` = 'FULFILLED'
          AND p.\`payment_status\` = 'SUCCEEDED'
          AND p.\`paid_at\` IS NOT NULL
          AND p.\`voided_at\` IS NULL)
        OR (p.\`status\` = 'VOIDED'
          AND p.\`payment_status\` = 'REVERSED'
          AND p.\`paid_at\` IS NOT NULL
          AND p.\`voided_at\` IS NOT NULL)
      )
      LIMIT 1`);
    assertNoViolation(invalidPurchaseStates, 'preflight:purchase-state-shape');

    const invalidFulfilledCardinality = await queryRunner.query(`SELECT
        /* preflight:fulfilled-membership-cardinality */
        p.\`id\`
      FROM \`membership_purchase_orders\` p
      LEFT JOIN \`user_memberships\` membership
        ON membership.\`purchase_order_id\` = p.\`id\`
      WHERE ((p.\`status\` = 'FULFILLED' AND p.\`payment_status\` = 'SUCCEEDED')
          OR (p.\`status\` = 'VOIDED' AND p.\`payment_status\` = 'REVERSED'))
        AND p.\`paid_at\` IS NOT NULL
      GROUP BY p.\`id\`
      HAVING COUNT(membership.\`id\`) <> 1
      LIMIT 1`);
    assertNoViolation(
      invalidFulfilledCardinality,
      'preflight:fulfilled-membership-cardinality',
    );

    const invalidMembershipPeriod = await queryRunner.query(`SELECT
        /* preflight:membership-period */
        membership.\`id\`
      FROM \`user_memberships\` membership
      WHERE membership.\`ends_at\` <= membership.\`starts_at\`
      LIMIT 1`);
    assertNoViolation(invalidMembershipPeriod, 'preflight:membership-period');

    const invalidVoidedTimeOrder = await queryRunner.query(`SELECT
        /* preflight:voided-time-order */
        p.\`id\`
      FROM \`membership_purchase_orders\` p
      WHERE p.\`status\` = 'VOIDED'
        AND p.\`payment_status\` = 'REVERSED'
        AND p.\`paid_at\` IS NOT NULL
        AND p.\`voided_at\` IS NOT NULL
        AND p.\`voided_at\` < p.\`paid_at\`
      LIMIT 1`);
    assertNoViolation(invalidVoidedTimeOrder, 'preflight:voided-time-order');

    const invalidFulfilledIntegrity = await queryRunner.query(`SELECT
        /* preflight:fulfilled-membership-integrity */
        p.\`id\`
      FROM \`membership_purchase_orders\` p
      INNER JOIN \`user_memberships\` membership
        ON membership.\`purchase_order_id\` = p.\`id\`
      WHERE ((p.\`status\` = 'FULFILLED' AND p.\`payment_status\` = 'SUCCEEDED')
          OR (p.\`status\` = 'VOIDED' AND p.\`payment_status\` = 'REVERSED'))
        AND p.\`paid_at\` IS NOT NULL
        AND (
          membership.\`user_id\` <> p.\`user_id\`
          OR membership.\`membership_level_id\` <> p.\`membership_level_id\`
          OR membership.\`level_code\` <> p.\`level_code\`
          OR membership.\`level_name\` <> p.\`level_name\`
          OR membership.\`level_rank\` <> p.\`level_rank\`
          OR membership.\`discount_basis_points\` <> p.\`discount_basis_points\`
          OR membership.\`benefits\` <> p.\`benefits\`
          OR membership.\`theme\` <> p.\`theme\`
          OR membership.\`badge_text\` <> p.\`badge_text\`
        )
      LIMIT 1`);
    assertNoViolation(
      invalidFulfilledIntegrity,
      'preflight:fulfilled-membership-integrity',
    );

    const membershipSnapshot = asMembershipSnapshot(
      await queryRunner.query(MEMBERSHIP_SNAPSHOT_SQL('preflight')),
    );

    const createTableSql = `CREATE TABLE \`membership_entitlement_segments\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`membership_id\` BIGINT UNSIGNED NOT NULL,
      \`purchase_order_id\` BIGINT UNSIGNED NOT NULL,
      \`kind\` ENUM('INITIAL','RENEWAL','UPGRADE') NOT NULL,
      \`starts_at\` DATETIME NOT NULL,
      \`ends_at\` DATETIME NOT NULL,
      \`previous_membership_id\` BIGINT UNSIGNED NULL,
      \`previous_membership_ends_at\` DATETIME NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`uniq_membership_entitlement_segments_purchase\` (\`purchase_order_id\`),
      INDEX \`idx_membership_entitlement_segments_membership_period\` (\`membership_id\`, \`ends_at\`, \`id\`),
      CONSTRAINT \`chk_membership_entitlement_segments_period\` CHECK (\`ends_at\` > \`starts_at\`),
      CONSTRAINT \`chk_membership_entitlement_segments_upgrade_restore\` CHECK ((\`kind\` = 'UPGRADE' AND \`previous_membership_id\` IS NOT NULL AND \`previous_membership_ends_at\` IS NOT NULL) OR (\`kind\` IN ('INITIAL','RENEWAL') AND \`previous_membership_id\` IS NULL AND \`previous_membership_ends_at\` IS NULL)),
      CONSTRAINT \`fk_membership_entitlement_segments_membership\` FOREIGN KEY (\`membership_id\`) REFERENCES \`user_memberships\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_membership_entitlement_segments_purchase\` FOREIGN KEY (\`purchase_order_id\`) REFERENCES \`membership_purchase_orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_membership_entitlement_segments_previous\` FOREIGN KEY (\`previous_membership_id\`) REFERENCES \`user_memberships\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

    await queryRunner.query(createTableSql);

    try {
      await queryRunner.query(`INSERT INTO \`membership_entitlement_segments\`
          (\`membership_id\`, \`purchase_order_id\`, \`kind\`, \`starts_at\`, \`ends_at\`,
           \`previous_membership_id\`, \`previous_membership_ends_at\`)
        SELECT
          membership.\`id\`,
          p.\`id\`,
          CASE WHEN (
            previous.\`id\` IS NOT NULL
            AND previous.\`user_id\` = membership.\`user_id\`
            AND membership.\`user_id\` = p.\`user_id\`
            AND membership.\`membership_level_id\` = p.\`membership_level_id\`
            AND membership.\`level_code\` = p.\`level_code\`
            AND membership.\`level_rank\` = p.\`level_rank\`
            AND membership.\`level_rank\` > previous.\`level_rank\`
            AND membership.\`starts_at\` = p.\`paid_at\`
            AND previous.\`starts_at\` <= p.\`paid_at\`
            AND previous.\`ends_at\` > p.\`paid_at\`
          ) THEN '${MembershipEntitlementSegmentKind.UPGRADE}'
            ELSE '${MembershipEntitlementSegmentKind.INITIAL}' END,
          membership.\`starts_at\`,
          membership.\`ends_at\`,
          CASE WHEN (
            previous.\`id\` IS NOT NULL
            AND previous.\`user_id\` = membership.\`user_id\`
            AND membership.\`user_id\` = p.\`user_id\`
            AND membership.\`membership_level_id\` = p.\`membership_level_id\`
            AND membership.\`level_code\` = p.\`level_code\`
            AND membership.\`level_rank\` = p.\`level_rank\`
            AND membership.\`level_rank\` > previous.\`level_rank\`
            AND membership.\`starts_at\` = p.\`paid_at\`
            AND previous.\`starts_at\` <= p.\`paid_at\`
            AND previous.\`ends_at\` > p.\`paid_at\`
          ) THEN previous.\`id\` ELSE NULL END,
          CASE WHEN (
            previous.\`id\` IS NOT NULL
            AND previous.\`user_id\` = membership.\`user_id\`
            AND membership.\`user_id\` = p.\`user_id\`
            AND membership.\`membership_level_id\` = p.\`membership_level_id\`
            AND membership.\`level_code\` = p.\`level_code\`
            AND membership.\`level_rank\` = p.\`level_rank\`
            AND membership.\`level_rank\` > previous.\`level_rank\`
            AND membership.\`starts_at\` = p.\`paid_at\`
            AND previous.\`starts_at\` <= p.\`paid_at\`
            AND previous.\`ends_at\` > p.\`paid_at\`
          ) THEN previous.\`ends_at\` ELSE NULL END
        FROM \`membership_purchase_orders\` p
        INNER JOIN \`user_memberships\` membership
          ON membership.\`purchase_order_id\` = p.\`id\`
        LEFT JOIN \`user_memberships\` previous
          ON previous.\`id\` = membership.\`previous_membership_id\`
        WHERE p.\`status\` IN ('FULFILLED','VOIDED')
          AND p.\`payment_status\` IN ('SUCCEEDED','REVERSED')
          AND p.\`paid_at\` IS NOT NULL
          AND ((p.\`status\` = 'FULFILLED' AND p.\`payment_status\` = 'SUCCEEDED')
            OR (p.\`status\` = 'VOIDED' AND p.\`payment_status\` = 'REVERSED'))`);

      const invalidSegmentCardinality = await queryRunner.query(`SELECT
          /* postflight:fulfilled-segment-cardinality */
          p.\`id\`
        FROM \`membership_purchase_orders\` p
        LEFT JOIN \`membership_entitlement_segments\` segment
          ON segment.\`purchase_order_id\` = p.\`id\`
        WHERE ((p.\`status\` = 'FULFILLED' AND p.\`payment_status\` = 'SUCCEEDED')
            OR (p.\`status\` = 'VOIDED' AND p.\`payment_status\` = 'REVERSED'))
          AND p.\`paid_at\` IS NOT NULL
        GROUP BY p.\`id\`
        HAVING COUNT(segment.\`id\`) <> 1
        LIMIT 1`);
      assertNoViolation(
        invalidSegmentCardinality,
        'postflight:fulfilled-segment-cardinality',
      );

      const pendingWithSegment = await queryRunner.query(`SELECT
          /* postflight:pending-with-segment */
          p.\`id\`
        FROM \`membership_purchase_orders\` p
        INNER JOIN \`membership_entitlement_segments\` segment
          ON segment.\`purchase_order_id\` = p.\`id\`
        WHERE p.\`status\` = 'PENDING'
        LIMIT 1`);
      assertNoViolation(pendingWithSegment, 'postflight:pending-with-segment');

      const invalidSegmentShape = await queryRunner.query(`SELECT
          /* postflight:segment-shape */
          segment.\`id\`
        FROM \`membership_entitlement_segments\` segment
        INNER JOIN \`user_memberships\` membership
          ON membership.\`id\` = segment.\`membership_id\`
        WHERE segment.\`ends_at\` <= segment.\`starts_at\`
          OR segment.\`starts_at\` <> membership.\`starts_at\`
          OR segment.\`ends_at\` <> membership.\`ends_at\`
          OR (segment.\`kind\` = 'UPGRADE'
            AND (segment.\`previous_membership_id\` IS NULL
              OR segment.\`previous_membership_ends_at\` IS NULL))
          OR (segment.\`kind\` IN ('INITIAL','RENEWAL')
            AND (segment.\`previous_membership_id\` IS NOT NULL
              OR segment.\`previous_membership_ends_at\` IS NOT NULL))
        LIMIT 1`);
      assertNoViolation(invalidSegmentShape, 'postflight:segment-shape');

      const membershipAfter = asMembershipSnapshot(
        await queryRunner.query(MEMBERSHIP_SNAPSHOT_SQL('postflight')),
      );
      if (!snapshotsMatch(membershipSnapshot, membershipAfter)) {
        throw new Error(
          'Membership entitlement migration postflight:membership-unchanged failed',
        );
      }
    } catch (error) {
      await queryRunner.query(
        'DROP TABLE IF EXISTS `membership_entitlement_segments`',
      );
      throw error;
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const renewals = await queryRunner.query(`SELECT
        /* down-guard:renewal */
        segment.\`id\`
      FROM \`membership_entitlement_segments\` segment
      WHERE segment.\`kind\` = 'RENEWAL'
      LIMIT 1`);
    const renewal = asViolationRows(renewals)[0];
    if (renewal) {
      throw new Error(
        `Cannot lossless revert membership entitlement RENEWAL segment ${String(renewal.id)}`,
      );
    }

    const truncatedUpgrades = await queryRunner.query(`SELECT
        /* down-guard:truncated-upgrade */
        segment.\`id\`
      FROM \`membership_entitlement_segments\` segment
      INNER JOIN \`user_memberships\` previous
        ON previous.\`id\` = segment.\`previous_membership_id\`
      WHERE segment.\`kind\` = 'UPGRADE'
        AND previous.\`ends_at\` < segment.\`previous_membership_ends_at\`
      LIMIT 1`);
    const truncatedUpgrade = asViolationRows(truncatedUpgrades)[0];
    if (truncatedUpgrade) {
      throw new Error(
        `Cannot lossless revert membership entitlement UPGRADE segment ${String(truncatedUpgrade.id)}`,
      );
    }

    await queryRunner.query('DROP TABLE `membership_entitlement_segments`');
  }
}
