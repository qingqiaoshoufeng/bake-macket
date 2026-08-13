import type { MigrationInterface, QueryRunner } from 'typeorm';

const UNKNOWN_METADATA_COLUMNS = [
  {
    name: 'unknown_since_at',
    definition: '`unknown_since_at` DATETIME NULL',
  },
  {
    name: 'unknown_query_count',
    definition: '`unknown_query_count` INT UNSIGNED NOT NULL DEFAULT 0',
  },
  {
    name: 'last_unknown_query_at',
    definition: '`last_unknown_query_at` DATETIME NULL',
  },
] as const;

function existingColumnNames(result: unknown): ReadonlySet<string> {
  if (!Array.isArray(result)) {
    throw new Error('0013 column lookup returned an invalid result');
  }
  return new Set(
    result.map((row) => {
      if (typeof row !== 'object' || row === null) {
        throw new Error('0013 column lookup returned an invalid row');
      }
      const name = (row as Record<string, unknown>).column_name;
      if (typeof name !== 'string') {
        throw new Error('0013 column lookup returned an invalid column name');
      }
      return name;
    }),
  );
}

/** Repairs databases that ran the pre-recovery version of migration 0012. */
export class PrintJobUnknownMetadata1718000000012 implements MigrationInterface {
  name = 'PrintJobUnknownMetadata1718000000012';

  async up(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      `SELECT COLUMN_NAME AS \`column_name\`
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'print_jobs'
         AND COLUMN_NAME IN ('unknown_since_at', 'unknown_query_count', 'last_unknown_query_at')`,
    );
    const existing = existingColumnNames(rows);
    const missing = UNKNOWN_METADATA_COLUMNS.filter(
      (column) => !existing.has(column.name),
    );
    if (missing.length === 0) return;
    await queryRunner.query(
      `ALTER TABLE \`print_jobs\` ${missing
        .map((column) => `ADD COLUMN ${column.definition}`)
        .join(', ')}`,
    );
  }

  async down(): Promise<void> {
    // Compatibility repair only: dropping these fields would destroy recovery evidence.
  }
}
