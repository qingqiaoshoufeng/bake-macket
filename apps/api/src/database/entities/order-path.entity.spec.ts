import 'reflect-metadata';

import { DataSource, type EntityTarget } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { Order } from './order.entity.js';
import { OrderItem } from './order-item.entity.js';
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
      entities: [User, Order, OrderItem],
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
  });
});
