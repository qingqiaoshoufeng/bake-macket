import 'reflect-metadata';

import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { IdempotencyRecord } from './idempotency-record.entity.js';
import { User } from './user.entity.js';

describe('IdempotencyRecord entity metadata', () => {
  it('maps properties to the existing idempotency_records columns', async () => {
    const dataSource = new DataSource({
      type: 'mysql',
      database: 'metadata_test',
      entities: [User, IdempotencyRecord],
    });

    await (
      dataSource as DataSource & { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    const metadata = dataSource.getMetadata(IdempotencyRecord);
    const databaseNameByProperty = Object.fromEntries(
      metadata.columns.map(({ propertyName, databaseName }) => [
        propertyName,
        databaseName,
      ]),
    );

    expect(databaseNameByProperty).toMatchObject({
      userId: 'user_id',
      orderId: 'order_id',
      createdAt: 'created_at',
    });
    expect(
      metadata.columns.some(({ databaseName }) =>
        ['userId', 'orderId', 'createdAt'].includes(databaseName),
      ),
    ).toBe(false);
  });
});
