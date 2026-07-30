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
import { Task12AdminMediaAndOrderIndexes1718000000002 } from './migrations/0003-task12-admin-media-and-order-indexes.js';
import { SkuStockVersion1718000000003 } from './migrations/0004-sku-stock-version.js';
import { MembershipAndOrderPricing1718000000004 } from './migrations/0005-membership-and-order-pricing.js';
import { MembershipEntitlementSegments1718000000005 } from './migrations/0006-membership-entitlement-segments.js';
import { DefaultMembershipLevels1718000000006 } from './migrations/0007-default-membership-levels.js';
import { OrderItemSourceIds1718000000007 } from './migrations/0008-order-item-source-ids.js';
import { HomepagePages1718000000008 } from './migrations/0009-homepage-pages.js';

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
            Task12AdminMediaAndOrderIndexes1718000000002,
            SkuStockVersion1718000000003,
            MembershipAndOrderPricing1718000000004,
            MembershipEntitlementSegments1718000000005,
            DefaultMembershipLevels1718000000006,
            OrderItemSourceIds1718000000007,
            HomepagePages1718000000008,
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
