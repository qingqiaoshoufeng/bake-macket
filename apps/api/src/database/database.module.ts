import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  type AppConfig,
  buildDataSourceOptions,
} from '../config/env.schema.js';
import * as entities from './entities/index.js';
import { DATABASE_MIGRATIONS } from './migrations/index.js';

/**
 * Wires the validated environment into TypeORM. `synchronize` is hard-coded to
 * `false`; the schema is owned by migrations in {@link ./migrations}. Tables
 * use the `utf8mb4` charset and all timestamps are stored as UTC.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const env = config.get('appEnv', { infer: true });
        return {
          ...buildDataSourceOptions(env),
          entities: Object.values(entities),
          migrations: [...DATABASE_MIGRATIONS],
          migrationsTableName: 'migrations',
          migrationsRun: false,
          autoLoadEntities: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
