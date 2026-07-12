import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  type AppConfig,
  buildDataSourceOptions,
} from '../config/env.schema.js';
import * as entities from './entities/index.js';
import { InitialSchema1718000000000 } from './migrations/0001-initial-schema.js';
import { ProductSortOrder1718000000001 } from './migrations/0002-product-sort-order.js';

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
          migrations: [
            InitialSchema1718000000000,
            ProductSortOrder1718000000001,
          ],
          migrationsTableName: 'migrations',
          migrationsRun: false,
          autoLoadEntities: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
