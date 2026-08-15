import { InitialSchema1718000000000 } from './0001-initial-schema.js';
import { ProductSortOrder1718000000001 } from './0002-product-sort-order.js';
import { Task12AdminMediaAndOrderIndexes1718000000002 } from './0003-task12-admin-media-and-order-indexes.js';
import { SkuStockVersion1718000000003 } from './0004-sku-stock-version.js';
import { MembershipAndOrderPricing1718000000004 } from './0005-membership-and-order-pricing.js';
import { MembershipEntitlementSegments1718000000005 } from './0006-membership-entitlement-segments.js';
import { DefaultMembershipLevels1718000000006 } from './0007-default-membership-levels.js';
import { OrderItemSourceIds1718000000007 } from './0008-order-item-source-ids.js';
import { HomepagePages1718000000008 } from './0009-homepage-pages.js';
import { HomepageMultipleDrafts1718000000009 } from './0010-homepage-multiple-drafts.js';
import { UserAdminIdentity1718000000009 } from './0011-user-admin-identity.js';
import { CloudPrinters1718000000010 } from './0012-cloud-printers.js';
import { CloudPrintJobs1718000000011 } from './0013-cloud-print-jobs.js';
import { PrintJobUnknownMetadata1718000000012 } from './0014-print-job-unknown-metadata.js';
import { OrderContactAndAdminLoginPhone1718000000013 } from './0015-order-contact-and-admin-login-phone.js';

export const DATABASE_MIGRATIONS = [
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
  UserAdminIdentity1718000000009,
  CloudPrinters1718000000010,
  CloudPrintJobs1718000000011,
  PrintJobUnknownMetadata1718000000012,
  OrderContactAndAdminLoginPhone1718000000013,
] as const;

type MigrationClass = (typeof DATABASE_MIGRATIONS)[number];

export const migrationsThrough = (
  name: string,
  migrations: readonly MigrationClass[] = DATABASE_MIGRATIONS,
): MigrationClass[] => {
  const matches = migrations.reduce<number[]>(
    (indexes, migration, index) =>
      migration.name === name ? [...indexes, index] : indexes,
    [],
  );

  if (matches.length === 0) throw new Error(`Migration not found: ${name}`);
  if (matches.length > 1) {
    throw new Error(`Migration registered more than once: ${name}`);
  }
  return migrations.slice(0, matches[0] + 1);
};
