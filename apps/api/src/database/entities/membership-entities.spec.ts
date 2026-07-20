import 'reflect-metadata';

import { DataSource, type EntityTarget } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { IdempotencyRecord } from './idempotency-record.entity.js';
import { MemberAccount } from './member-account.entity.js';
import { MemberCreditAllocation } from './member-credit-allocation.entity.js';
import { MemberCreditEntry } from './member-credit-entry.entity.js';
import { MemberCreditGrant } from './member-credit-grant.entity.js';
import { MembershipLevel } from './membership-level.entity.js';
import { MembershipPurchaseOrder } from './membership-purchase-order.entity.js';
import { OrderItem } from './order-item.entity.js';
import { Order } from './order.entity.js';
import { UserMembership } from './user-membership.entity.js';
import { User } from './user.entity.js';

const EXPECTED_COLUMNS = new Map<EntityTarget<unknown>, readonly string[]>([
  [
    MembershipLevel,
    [
      'id',
      'code',
      'name',
      'subtitle',
      'description',
      'rank',
      'price_cents',
      'grant_credit_cents',
      'discount_basis_points',
      'valid_days',
      'benefits',
      'theme',
      'badge_text',
      'sort_order',
      'is_active',
      'version',
      'created_at',
      'updated_at',
    ],
  ],
  [
    MemberAccount,
    [
      'id',
      'user_id',
      'active_membership_id',
      'available_credit_cents',
      'version',
      'created_at',
      'updated_at',
    ],
  ],
  [
    MembershipPurchaseOrder,
    [
      'id',
      'purchase_no',
      'user_id',
      'membership_level_id',
      'level_code',
      'level_name',
      'level_rank',
      'price_cents',
      'grant_credit_cents',
      'discount_basis_points',
      'valid_days',
      'benefits',
      'theme',
      'badge_text',
      'status',
      'payment_status',
      'payment_channel',
      'idempotency_key',
      'request_hash',
      'paid_at',
      'voided_at',
      'created_at',
      'updated_at',
    ],
  ],
  [
    UserMembership,
    [
      'id',
      'user_id',
      'purchase_order_id',
      'membership_level_id',
      'level_code',
      'level_name',
      'level_rank',
      'discount_basis_points',
      'benefits',
      'theme',
      'badge_text',
      'starts_at',
      'ends_at',
      'previous_membership_id',
      'status',
      'created_at',
      'updated_at',
    ],
  ],
  [
    MemberCreditGrant,
    [
      'id',
      'account_id',
      'purchase_order_id',
      'granted_cents',
      'remaining_cents',
      'status',
      'created_at',
      'updated_at',
    ],
  ],
  [
    MemberCreditEntry,
    [
      'id',
      'account_id',
      'direction',
      'type',
      'amount_cents',
      'balance_after_cents',
      'reference_type',
      'reference_id',
      'operation_key',
      'reversal_of_entry_id',
      'created_at',
    ],
  ],
  [
    MemberCreditAllocation,
    ['id', 'credit_entry_id', 'grant_id', 'amount_cents', 'created_at'],
  ],
]);

const entities = [
  User,
  MembershipLevel,
  MemberAccount,
  MembershipPurchaseOrder,
  UserMembership,
  MemberCreditGrant,
  MemberCreditEntry,
  MemberCreditAllocation,
  Order,
  OrderItem,
  IdempotencyRecord,
];

const databaseColumns = (
  dataSource: DataSource,
  entity: EntityTarget<unknown>,
): string[] =>
  dataSource
    .getMetadata(entity)
    .columns.map(({ databaseName }) => databaseName)
    .toSorted();

describe('membership and pricing entity metadata', () => {
  it('maps every membership entity to its migrated columns', async () => {
    const dataSource = new DataSource({
      type: 'mysql',
      database: 'metadata_test',
      entities,
    });

    await (
      dataSource as DataSource & { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    for (const [entity, expectedColumns] of EXPECTED_COLUMNS) {
      expect(databaseColumns(dataSource, entity)).toEqual(
        [...expectedColumns].toSorted(),
      );
    }
  });

  it('uses unsigned integer metadata for identifiers, money, quantities, and versions', async () => {
    const dataSource = new DataSource({
      type: 'mysql',
      database: 'metadata_test',
      entities,
    });

    await (
      dataSource as DataSource & { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    for (const entity of [...EXPECTED_COLUMNS.keys(), Order, OrderItem]) {
      const numericColumns = dataSource
        .getMetadata(entity)
        .columns.filter(({ type }) => ['bigint', 'int'].includes(String(type)));
      expect(numericColumns.every(({ unsigned }) => unsigned)).toBe(true);
    }
  });

  it('extends order snapshots and generalizes idempotency metadata', async () => {
    const dataSource = new DataSource({
      type: 'mysql',
      database: 'metadata_test',
      entities,
    });

    await (
      dataSource as DataSource & { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    expect(databaseColumns(dataSource, Order)).toEqual(
      [
        'id',
        'order_no',
        'user_id',
        'status',
        'fulfillment_type',
        'contact_name',
        'contact_phone',
        'pickup_time_text',
        'delivery_address_text',
        'goods_total_cents',
        'membership_discount_cents',
        'credit_applied_cents',
        'payable_total_cents',
        'membership_id',
        'membership_code',
        'membership_name',
        'membership_discount_basis_points',
        'pricing_version',
        'remark',
        'created_at',
        'updated_at',
      ].toSorted(),
    );
    expect(databaseColumns(dataSource, OrderItem)).toEqual(
      [
        'id',
        'order_id',
        'product_name',
        'sku_name',
        'sku_attributes',
        'image_url',
        'unit_price_cents',
        'quantity',
        'line_goods_total_cents',
        'line_membership_discount_cents',
        'line_payable_cents',
        'created_at',
      ].toSorted(),
    );
    expect(databaseColumns(dataSource, IdempotencyRecord)).toEqual(
      [
        'id',
        'user_id',
        'operation',
        'key',
        'request_hash',
        'status',
        'resource_type',
        'resource_id',
        'response_snapshot',
        'order_id',
        'expires_at',
        'created_at',
        'updated_at',
      ].toSorted(),
    );

    const unique = dataSource
      .getMetadata(IdempotencyRecord)
      .indices.find(({ givenName }) =>
        givenName === 'uniq_idempotency_user_operation_key',
      );
    expect(unique?.isUnique).toBe(true);
    expect(unique?.columns.map(({ propertyName }) => propertyName)).toEqual([
      'userId',
      'operation',
      'key',
    ]);
  });
});
