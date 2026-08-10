import 'reflect-metadata';

import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';

import {
  buildDataSourceOptions,
  validateEnvironment,
} from '../config/env.schema.js';
import * as entities from './entities/index.js';
import { DATABASE_MIGRATIONS } from './migrations/index.js';

if (process.env.NODE_ENV !== 'production') {
  loadDotenv({ path: '../../.env.development' });
  loadDotenv();
}

const environment = validateEnvironment(process.env);

/**
 * Stand-alone TypeORM {@link DataSource} used by the CLI scripts:
 *
 * - `pnpm migration:generate`
 * - `pnpm migration:run`
 * - `pnpm migration:revert`
 *
 * At runtime the Nest app uses {@link DatabaseModule} which feeds the same
 * options into `TypeOrmModule.forRootAsync` from the validated config.
 */
export const AppDataSource = new DataSource({
  ...buildDataSourceOptions(environment),
  entities: Object.values(entities),
  migrations: [...DATABASE_MIGRATIONS],
  migrationsTableName: 'migrations',
  // The CLI runs migrations; runtime uses migrationsRun: false to keep startup
  // deterministic and surface migration errors during deploy steps instead.
  migrationsRun: false,
});
