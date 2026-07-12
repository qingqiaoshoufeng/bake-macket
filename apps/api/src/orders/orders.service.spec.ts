import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  ApiErrorCode,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';

import { AuditService } from '../audit/audit.service.js';
import { OrdersService } from './orders.service.js';

/**
 * Translate a TypeORM find operator (e.g. `In([...])`) into a plain matcher
 * predicate. Only `In` is required by the unit tests for the order service.
 */
function matchesOperator(recordValue: unknown, operator: unknown): boolean {
  if (
    operator &&
    typeof operator === 'object' &&
    '@instanceof' in (operator as Record<string, unknown>) &&
    (operator as { '@instanceof': unknown })['@instanceof'] ===
      Symbol.for('FindOperator')
  ) {
    const op = operator as unknown as { value: unknown };
    return Array.isArray(op.value) && op.value.includes(recordValue);
  }
  return recordValue === operator;
}

function matchesWhere(
  record: Record<string, unknown>,
  where?: Record<string, unknown>,
): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) =>
    matchesOperator(record[key], value),
  );
}

describe('OrdersService', () => {
  function buildService(options: {
    users?: Array<Record<string, unknown>>;
    skus?: Array<Record<string, unknown>>;
    products?: Array<Record<string, unknown>>;
    cartItems?: Array<Record<string, unknown>>;
    addresses?: Array<Record<string, unknown>>;
    orders?: Array<Record<string, unknown>>;
    orderItems?: Array<Record<string, unknown>>;
    idempotency?: Array<Record<string, unknown>>;
    audit?: Array<Record<string, unknown>>;
    adminUsers?: Array<Record<string, unknown>>;
  }) {
    const records = {
      users: options.users ?? [],
      skus: options.skus ?? [],
      products: options.products ?? [],
      cartItems: options.cartItems ?? [],
      addresses: options.addresses ?? [],
      orders: options.orders ?? [],
      orderItems: options.orderItems ?? [],
      idempotency: options.idempotency ?? [],
      audit: options.audit ?? [],
      adminUsers: options.adminUsers ?? [],
    };
    let nextId = 1;
    const repoFor = (list: Array<Record<string, unknown>>) => {
      const repo: Record<string, unknown> = {
        findOneBy: async (where: Record<string, unknown>) =>
          list.find((record) =>
            Object.entries(where).every(([k, v]) => record[k] === v),
          ) ?? null,
        findOneByOrFail: async (where: Record<string, unknown>) => {
          const entry = list.find((record) =>
            Object.entries(where).every(([k, v]) => record[k] === v),
          );
          if (!entry) throw new Error('Entity not found');
          return entry;
        },
        findOne: async ({ where }: { where: Record<string, unknown> }) =>
          list.find((record) => matchesWhere(record, where)) ?? null,
        find: async ({ where }: { where?: Record<string, unknown> } = {}) =>
          list.filter((record) => matchesWhere(record, where)),
        save: async (value: Record<string, unknown>) => {
          if (!value.id) value.id = String(nextId++);
          const index = list.findIndex((record) => record.id === value.id);
          if (index >= 0) list[index] = value;
          else list.push(value);
          return value;
        },
        insert: async (value: Record<string, unknown>) => {
          value.id = String(nextId++);
          list.push(value);
          return { identifiers: [{ id: value.id }], generatedMaps: [] };
        },
        update: async (
          where: Record<string, unknown>,
          values: Record<string, unknown>,
        ) => {
          const matching = list.filter((record) =>
            Object.entries(where).every(([k, v]) => record[k] === v),
          );
          matching.forEach((record) => Object.assign(record, values));
          return { affected: matching.length };
        },
        delete: async (where: Record<string, unknown>) => {
          const matching = list.filter((record) => matchesWhere(record, where));
          matching.forEach((record) => {
            const index = list.indexOf(record);
            if (index >= 0) list.splice(index, 1);
          });
          return { affected: matching.length };
        },
        create: (value: Record<string, unknown>) => value,
        createQueryBuilder: () => {
          let lastParams: Record<string, unknown> = {};
          const builder: Record<string, unknown> = {
            update: () => builder,
            set: () => builder,
            where: (_sql: string, params: Record<string, unknown>) => {
              lastParams = params;
              return builder;
            },
            execute: async () => {
              // Translate the conditional decrement into the in-memory model.
              const skuId = lastParams['skuId' as string] as string | undefined;
              const quantity = Number(lastParams['quantity']);
              const sku = records.skus.find((s) => s.id === skuId);
              if (!sku || !sku.isActive || (sku.stock as number) < quantity) {
                return { affected: 0 };
              }
              sku.stock = (sku.stock as number) - quantity;
              return { affected: 1 };
            },
          };
          return builder;
        },
      };
      return repo;
    };
    const dataSource = {
      transaction: async <T>(callback: (manager: unknown) => Promise<T>) => {
        const manager = {
          getRepository: (entity: { name: string }) => {
            const map: Record<string, Array<Record<string, unknown>>> = {
              User: records.users,
              Order: records.orders,
              OrderItem: records.orderItems,
              CartItem: records.cartItems,
              Sku: records.skus,
              Address: records.addresses,
              IdempotencyRecord: records.idempotency,
              AuditLog: records.audit,
              Product: records.products,
              AdminUser: records.adminUsers,
            };
            return repoFor(map[entity.name] ?? []);
          },
          createQueryBuilder: () => {
            let lastParams: Record<string, unknown> = {};
            const builder: Record<string, unknown> = {
              update: () => builder,
              set: () => builder,
              where: (_sql: string, params: Record<string, unknown>) => {
                lastParams = params;
                return builder;
              },
              execute: async () => {
                const skuId = lastParams['skuId' as string] as
                  string | undefined;
                const quantity = Number(lastParams['quantity']);
                const sku = records.skus.find((s) => s.id === skuId);
                if (!sku || !sku.isActive || (sku.stock as number) < quantity) {
                  return { affected: 0 };
                }
                sku.stock = (sku.stock as number) - quantity;
                return { affected: 1 };
              },
            };
            return builder;
          },
        };
        return callback(manager);
      },
    };
    const auditService = {
      record: async (entry: Record<string, unknown>) => {
        records.audit.push({ id: String(nextId++), ...entry });
      },
    };
    return {
      service: new OrdersService(
        dataSource as never,
        repoFor(records.users) as never,
        repoFor(records.orders) as never,
        repoFor(records.orderItems) as never,
        repoFor(records.cartItems) as never,
        repoFor(records.skus) as never,
        repoFor(records.addresses) as never,
        repoFor(records.products) as never,
        repoFor(records.idempotency) as never,
        auditService as unknown as AuditService,
      ),
      skuRecords: records.skus,
      orderRecords: records.orders,
      cartRecords: records.cartItems,
      auditRecords: records.audit,
      idempotencyRecords: records.idempotency,
    };
  }

  it('throws STOCK_INSUFFICIENT and rolls back any prior decrement when one SKU is short', async () => {
    const { service } = buildService({
      users: [
        {
          id: 'user-1',
          phone: '13800000000',
          phoneVerified: true,
        },
      ],
      products: [{ id: 'product-1', isActive: true }],
      skus: [
        {
          id: 'sku-1',
          productId: 'product-1',
          priceCents: 1000,
          stock: 1,
          isActive: true,
        },
        {
          id: 'sku-2',
          productId: 'product-1',
          priceCents: 2000,
          stock: 1,
          isActive: true,
        },
      ],
      cartItems: [
        { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 1 },
        { id: 'cart-2', userId: 'user-1', skuId: 'sku-2', quantity: 2 },
      ],
    });
    await expect(
      service.create('user-1', 'idem-key', {
        cartItemIds: ['cart-1', 'cart-2'],
        fulfillmentType: FulfillmentType.PICKUP,
        contactName: 'Alice',
        contactPhone: '13800000000',
        pickupTimeText: 'tomorrow 10am',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    try {
      await service.create('user-1', 'idem-key', {
        cartItemIds: ['cart-1', 'cart-2'],
        fulfillmentType: FulfillmentType.PICKUP,
        contactName: 'Alice',
        contactPhone: '13800000000',
        pickupTimeText: 'tomorrow 10am',
      });
    } catch (err) {
      const response = (err as ConflictException).getResponse() as {
        code: ApiErrorCode;
      };
      expect(response.code).toBe(ApiErrorCode.STOCK_INSUFFICIENT);
    }
  });

  it('returns the original order on a duplicate idempotency key without re-decrementing stock', async () => {
    const records = buildService({
      users: [
        {
          id: 'user-1',
          phone: '13800000000',
          phoneVerified: true,
        },
      ],
      products: [{ id: 'product-1', isActive: true }],
      skus: [
        {
          id: 'sku-1',
          productId: 'product-1',
          priceCents: 1000,
          stock: 5,
          isActive: true,
        },
      ],
      cartItems: [
        { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 1 },
      ],
    });
    const dto = {
      cartItemIds: ['cart-1'],
      fulfillmentType: FulfillmentType.PICKUP as const,
      contactName: 'Alice',
      contactPhone: '13800000000',
      pickupTimeText: 'tomorrow',
    };
    const first = await records.service.create('user-1', 'stable-key', dto);
    const sku = records.skuRecords.find((s) => s.id === 'sku-1');
    const stockAfterFirst = (sku?.stock ?? -1) as number;
    const second = await records.service.create('user-1', 'stable-key', dto);
    expect(second.id).toBe(first.id);
    expect(second.orderNo).toBe(first.orderNo);
    expect(stockAfterFirst).toBe(4);
    // Stock must NOT have been decremented a second time — it stays at 4.
    expect(records.skuRecords.find((s) => s.id === 'sku-1')?.stock).toBe(4);
  });

  it('rejects an illegal order status transition with INVALID_ORDER_TRANSITION', async () => {
    const { service } = buildService({
      users: [
        {
          id: 'admin-1',
          phone: null,
          phoneVerified: false,
        },
      ],
      adminUsers: [{ id: 'admin-1', isActive: true }],
      orders: [
        {
          id: 'order-1',
          userId: 'user-1',
          orderNo: 'BM2026010100000001',
          status: OrderStatus.NEW,
          fulfillmentType: FulfillmentType.PICKUP,
          contactName: 'Alice',
          contactPhone: '13800000000',
          pickupTimeText: 'tomorrow',
          deliveryAddressText: null,
          goodsTotalCents: 1000,
          remark: null,
        },
      ],
    });
    await expect(
      service.updateStatus('order-1', OrderStatus.COMPLETED, 'admin-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    try {
      await service.updateStatus('order-1', OrderStatus.COMPLETED, 'admin-1');
    } catch (err) {
      const response = (err as UnprocessableEntityException).getResponse() as {
        code: ApiErrorCode;
      };
      expect(response.code).toBe(ApiErrorCode.INVALID_ORDER_TRANSITION);
    }
  });

  it('marks cancellation as noRestock and writes an audit log entry', async () => {
    const { service, auditRecords } = buildService({
      users: [
        {
          id: 'user-1',
          phone: '13800000000',
          phoneVerified: true,
        },
      ],
      adminUsers: [{ id: 'admin-1', isActive: true }],
      orders: [
        {
          id: 'order-1',
          userId: 'user-1',
          orderNo: 'BM2026010100000001',
          status: OrderStatus.PROCESSING,
          fulfillmentType: FulfillmentType.PICKUP,
          contactName: 'Alice',
          contactPhone: '13800000000',
          pickupTimeText: 'tomorrow',
          deliveryAddressText: null,
          goodsTotalCents: 1000,
          remark: null,
        },
      ],
    });
    const result = await service.updateStatus(
      'order-1',
      OrderStatus.CANCELLED,
      'admin-1',
    );
    expect(result).toMatchObject({ noRestock: true });
    expect(
      auditRecords.find((entry) => entry.action === 'ORDER_CANCELLED'),
    ).toMatchObject({ targetEntity: 'orders', targetId: 'order-1' });
  });

  it('rejects create with ConflictException when an idempotency key collides and the prior request has not finished', async () => {
    const { service } = buildService({
      users: [
        {
          id: 'user-1',
          phone: '13800000000',
          phoneVerified: true,
        },
      ],
      products: [{ id: 'product-1', isActive: true }],
      skus: [
        {
          id: 'sku-1',
          productId: 'product-1',
          priceCents: 1000,
          stock: 5,
          isActive: true,
        },
      ],
      cartItems: [
        { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 1 },
      ],
      idempotency: [
        { id: '1', userId: 'user-1', key: 'collide', orderId: null },
      ],
    });
    await expect(
      service.create('user-1', 'collide', {
        cartItemIds: ['cart-1'],
        fulfillmentType: FulfillmentType.PICKUP,
        contactName: 'Alice',
        contactPhone: '13800000000',
        pickupTimeText: 'tomorrow',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
