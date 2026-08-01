import 'reflect-metadata';

import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';

import {
  buildDataSourceOptions,
  validateEnvironment,
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
import { HomepageMultipleDrafts1718000000009 } from './migrations/0010-homepage-multiple-drafts.js';

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
    HomepageMultipleDrafts1718000000009,
  ],
  migrationsTableName: 'migrations',
  // The CLI runs migrations; runtime uses migrationsRun: false to keep startup
  // deterministic and surface migration errors during deploy steps instead.
  migrationsRun: false,
});
