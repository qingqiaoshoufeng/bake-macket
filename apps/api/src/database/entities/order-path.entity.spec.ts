import 'reflect-metadata';

import { DataSource, type EntityTarget } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { Order } from './order.entity.js';
import { MembershipLevel } from './membership-level.entity.js';
import { MembershipPurchaseOrder } from './membership-purchase-order.entity.js';
import { OrderItem } from './order-item.entity.js';
import { UserMembership } from './user-membership.entity.js';
import { User } from './user.entity.js';

const EXPECTED_ORDER_COLUMNS = [
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
] as const;

const EXPECTED_ORDER_ITEM_COLUMNS = [
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
] as const;

function databaseColumns(
  dataSource: DataSource,
  entity: EntityTarget<unknown>,
) {
  return dataSource
    .getMetadata(entity)
    .columns.map(({ databaseName }) => databaseName)
    .toSorted();
}

describe('order path entity metadata', () => {
  it('matches the migrated orders and order_items columns without shadow columns', async () => {
    const dataSource = new DataSource({
      type: 'mysql',
      database: 'metadata_test',
      entities: [
        User,
        MembershipLevel,
        MembershipPurchaseOrder,
        UserMembership,
        Order,
        OrderItem,
      ],
    });

    await (
      dataSource as DataSource & { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    expect(databaseColumns(dataSource, Order)).toEqual(
      [...EXPECTED_ORDER_COLUMNS].toSorted(),
    );
    expect(databaseColumns(dataSource, OrderItem)).toEqual(
      [...EXPECTED_ORDER_ITEM_COLUMNS].toSorted(),
    );

    const membershipRelation = dataSource
      .getMetadata(Order)
      .relations.find(({ propertyName }) => propertyName === 'membership');
    expect(membershipRelation?.isNullable).toBe(true);
    expect(membershipRelation?.onDelete).toBe('RESTRICT');
    expect(
      membershipRelation?.joinColumns.map(({ databaseName }) => databaseName),
    ).toEqual(['membership_id']);
    expect(membershipRelation?.inverseEntityMetadata.target).toBe(
      UserMembership,
    );
    expect(membershipRelation?.onUpdate).toBe('CASCADE');
    expect(membershipRelation?.foreignKeys[0]?.name).toBe(
      'fk_orders_membership',
    );

    const orderMetadata = dataSource.getMetadata(Order);
    expect(
      orderMetadata.checks.find(
        ({ givenName }) => givenName === 'chk_orders_pricing_totals',
      )?.expression,
    ).toBe(
      '`payable_total_cents` = `goods_total_cents` - `membership_discount_cents` - `credit_applied_cents`',
    );
    expect(
      [
        'membershipDiscountCents',
        'creditAppliedCents',
        'payableTotalCents',
      ].map(
        (propertyName) =>
          orderMetadata.columns.find(
            (column) => column.propertyName === propertyName,
          )?.default,
      ),
    ).toEqual([0, 0, 0]);
    expect(
      orderMetadata.columns.find(
        ({ propertyName }) => propertyName === 'pricingVersion',
      )?.default,
    ).toBe(1);

    const orderItemMetadata = dataSource.getMetadata(OrderItem);
    expect(
      [
        'lineGoodsTotalCents',
        'lineMembershipDiscountCents',
        'linePayableCents',
      ].map(
        (propertyName) =>
          orderItemMetadata.columns.find(
            (column) => column.propertyName === propertyName,
          )?.default,
      ),
    ).toEqual([0, 0, 0]);
  });
});
