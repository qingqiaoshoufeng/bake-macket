import type { DataSource } from 'typeorm';

type MigrationDataSource = Pick<
  DataSource,
  'destroy' | 'initialize' | 'isInitialized' | 'runMigrations'
>;

export async function runMigrations(
  dataSource: MigrationDataSource,
): Promise<void> {
  try {
    await dataSource.initialize();
    await dataSource.runMigrations();
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

async function main(): Promise<void> {
  const { AppDataSource } = await import('./data-source.js');
  await runMigrations(AppDataSource);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error('Production migration failed.', error);
    process.exitCode = 1;
  });
}
