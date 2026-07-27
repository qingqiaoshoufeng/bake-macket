import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  ApiErrorCode,
  FulfillmentType,
  OrderStatus,
  type AdminOrderListQuery,
} from '@bake-mall/contracts';

import { AuditService } from '../audit/audit.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { MembershipCreditService } from '../membership/membership-credit.service.js';
import { OrderQuoteTokenService } from '../membership/order-quote-token.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
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
    memberAccounts?: Array<Record<string, unknown>>;
    memberships?: Array<Record<string, unknown>>;
    grants?: Array<Record<string, unknown>>;
    creditEntries?: Array<Record<string, unknown>>;
    quoteTokens?: Pick<OrderQuoteTokenService, 'verify'>;
    credit?: Pick<
      MembershipCreditService,
      'lockOrCreateAccount' | 'debitFifo'
    > &
      Partial<Pick<MembershipCreditService, 'reverseDebit'>>;
    idempotencyInsertError?: unknown;
    idempotencyAfterInsertError?: Record<string, unknown>;
    auditRecordError?: unknown;
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
      memberAccounts: options.memberAccounts ?? [],
      memberships: options.memberships ?? [],
      grants: options.grants ?? [],
      creditEntries: options.creditEntries ?? [],
    };
    let nextId = 1;
    const orderCreate = vi.fn((value: Record<string, unknown>) => value);
    const orderItemCreate = vi.fn((value: Record<string, unknown>) => value);
    const repoFor = (list: Array<Record<string, unknown>>) => {
      const orderBy = vi.fn();
      const addOrderBy = vi.fn();
      const andWhere = vi.fn();
      const repo: Record<string, unknown> = {
        orderBy,
        addOrderBy,
        andWhere,
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
        save: async (
          value: Record<string, unknown> | Array<Record<string, unknown>>,
        ) => {
          const saveOne = (record: Record<string, unknown>) => {
            const saved = {
              ...record,
              id: record.id ?? String(nextId++),
            };
            const index = list.findIndex((item) => item.id === saved.id);
            if (index >= 0) list[index] = saved;
            else list.push(saved);
            return saved;
          };
          return Array.isArray(value) ? value.map(saveOne) : saveOne(value);
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
          let setValues: Record<string, unknown> = {};
          const predicates: Array<
            (record: Record<string, unknown>) => boolean
          > = [];
          let offset = 0;
          let limit = Number.POSITIVE_INFINITY;
          const builder: Record<string, unknown> = {
            update: () => builder,
            set: (values: Record<string, unknown>) => {
              setValues = values;
              return builder;
            },
            where: (_sql: string, params: Record<string, unknown>) => {
              lastParams = params;
              return builder;
            },
            andWhere: (clause: string, parameters: Record<string, unknown>) => {
              andWhere(clause, parameters);
              const predicate = clause.includes('orderNo')
                ? (record: Record<string, unknown>) =>
                    String(record.orderNo).includes(
                      String(parameters.orderNo).replaceAll('%', ''),
                    )
                : clause.includes('fulfillmentType')
                  ? (record: Record<string, unknown>) =>
                      record.fulfillmentType === parameters.fulfillmentType
                  : clause.includes('createdAt >=')
                    ? (record: Record<string, unknown>) =>
                        (record.createdAt as Date) >=
                        (parameters.createdAtFrom as Date)
                    : clause.includes('createdAt <')
                      ? (record: Record<string, unknown>) =>
                          (record.createdAt as Date) <
                          (parameters.createdAtBefore as Date)
                      : (record: Record<string, unknown>) =>
                          record.status === parameters.status;
              predicates.push(predicate);
              return builder;
            },
            orderBy: (...args: unknown[]) => {
              orderBy(...args);
              return builder;
            },
            addOrderBy: (...args: unknown[]) => {
              addOrderBy(...args);
              return builder;
            },
            skip: (value: number) => {
              offset = value;
              return builder;
            },
            take: (value: number) => {
              limit = value;
              return builder;
            },
            getManyAndCount: async () => {
              const filtered = list.filter((record) =>
                predicates.every((predicate) => predicate(record)),
              );
              return [filtered.slice(offset, offset + limit), filtered.length];
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
              if (typeof setValues.stockVersion === 'function') {
                sku.stockVersion = Number(sku.stockVersion ?? 1) + 1;
              }
              return { affected: 1 };
            },
          };
          return builder;
        },
      };
      return repo;
    };
    const transaction = vi.fn(
      async <T>(callback: (manager: unknown) => Promise<T>) => {
        const snapshots = Object.fromEntries(
          Object.entries(records).map(([name, values]) => [
            name,
            values.map((value) => ({ ...value })),
          ]),
        ) as Record<string, Array<Record<string, unknown>>>;
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
              MemberAccount: records.memberAccounts,
              UserMembership: records.memberships,
              MemberCreditGrant: records.grants,
              MemberCreditEntry: records.creditEntries,
              MemberCreditAllocation: [],
            };
            const repo = repoFor(map[entity.name] ?? []);
            if (entity.name === 'Order') repo.create = orderCreate;
            if (entity.name === 'OrderItem') repo.create = orderItemCreate;
            if (
              entity.name === 'IdempotencyRecord' &&
              options.idempotencyInsertError
            ) {
              repo.insert = async () => {
                if (options.idempotencyAfterInsertError) {
                  records.idempotency.push(options.idempotencyAfterInsertError);
                }
                throw options.idempotencyInsertError;
              };
            }
            return repo;
          },
          createQueryBuilder: () => {
            let lastParams: Record<string, unknown> = {};
            let setValues: Record<string, unknown> = {};
            const builder: Record<string, unknown> = {
              update: () => builder,
              set: (values: Record<string, unknown>) => {
                setValues = values;
                return builder;
              },
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
                if (typeof setValues.stockVersion === 'function') {
                  sku.stockVersion = Number(sku.stockVersion ?? 1) + 1;
                }
                return { affected: 1 };
              },
            };
            return builder;
          },
        };
        try {
          return await callback(manager);
        } catch (error) {
          Object.entries(records).forEach(([name, values]) => {
            values.splice(
              0,
              values.length,
              ...snapshots[name].map((value) => ({ ...value })),
            );
          });
          throw error;
        }
      },
    );
    const dataSource = { transaction };
    const auditService = {
      record: async (entry: Record<string, unknown>) => {
        if (options.auditRecordError) throw options.auditRecordError;
        records.audit.push({ id: String(nextId++), ...entry });
      },
    };
    const quoteTokens = options.quoteTokens ?? {
      verify: vi.fn(),
    };
    const orderRepository = repoFor(records.orders);
    const idempotencyRepository = repoFor(records.idempotency);
    const idempotencyService = new IdempotencyService(
      idempotencyRepository as never,
    );
    const defaultCredit = new MembershipCreditService();
    const credit = options.credit
      ? {
          ...options.credit,
          reverseDebit:
            options.credit.reverseDebit ??
            defaultCredit.reverseDebit.bind(defaultCredit),
        }
      : defaultCredit;
    return {
      service: new OrdersService(
        dataSource as never,
        repoFor(records.users) as never,
        orderRepository as never,
        repoFor(records.orderItems) as never,
        repoFor(records.cartItems) as never,
        repoFor(records.skus) as never,
        repoFor(records.addresses) as never,
        repoFor(records.products) as never,
        auditService as unknown as AuditService,
        quoteTokens as OrderQuoteTokenService,
        credit as MembershipCreditService,
        idempotencyService,
      ),
      skuRecords: records.skus,
      orderRecords: records.orders,
      cartRecords: records.cartItems,
      auditRecords: records.audit,
      idempotencyRecords: records.idempotency,
      creditEntryRecords: records.creditEntries,
      memberAccountRecords: records.memberAccounts,
      orderCreate,
      orderItemCreate,
      transaction,
      quoteTokens,
      credit,
      orderQuerySpies: {
        orderBy: orderRepository.orderBy,
        addOrderBy: orderRepository.addOrderBy,
        andWhere: orderRepository.andWhere,
      },
    };
  }

  const pickupDto = (
    overrides: Partial<{
      cartItemIds: string[];
      contactName: string;
      contactPhone: string;
      pickupTimeText: string;
      requestedCreditCents: number;
      quoteToken: string;
      remark: string;
    }> = {},
  ) => ({
    cartItemIds: overrides.cartItemIds ?? ['cart-1'],
    fulfillmentType: FulfillmentType.PICKUP as const,
    contactName: overrides.contactName ?? '张三',
    contactPhone: overrides.contactPhone ?? '13800000000',
    pickupTimeText: overrides.pickupTimeText ?? '明天 10:00',
    ...(overrides.requestedCreditCents === undefined
      ? {}
      : { requestedCreditCents: overrides.requestedCreditCents }),
    ...(overrides.quoteToken === undefined
      ? {}
      : { quoteToken: overrides.quoteToken }),
    ...(overrides.remark === undefined ? {} : { remark: overrides.remark }),
  });

  const basicOrderRecords = () => ({
    users: [{ id: 'user-1', phone: '13800000000', phoneVerified: true }],
    products: [{ id: 'product-1', name: '草莓蛋糕', isActive: true }],
    skus: [
      {
        id: 'sku-1',
        productId: 'product-1',
        name: '6寸',
        attributes: { size: '6寸' },
        priceCents: 6_800,
        stock: 5,
        stockVersion: 3,
        isActive: true,
      },
    ],
    cartItems: [
      { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 1 },
    ],
  });

  it('returns the completed response snapshot for the same key and semantic request without reloading cart or order', async () => {
    const records = buildService(basicOrderRecords());
    const dto = pickupDto({ remark: '少糖' });

    const first = await records.service.create('user-1', 'snapshot-key', dto);
    records.orderRecords.length = 0;

    await expect(
      records.service.create('user-1', 'snapshot-key', dto),
    ).resolves.toEqual(first);
    expect(records.idempotencyRecords).toEqual([
      expect.objectContaining({
        operation: 'PRODUCT_ORDER_CREATE',
        key: 'snapshot-key',
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        status: 'COMPLETED',
        resourceType: 'ORDER',
        resourceId: first.id,
        responseSnapshot: first,
      }),
    ]);
    expect(records.skuRecords[0]?.stock).toBe(4);
  });

  it('rejects a completed response snapshot whose order item is missing its string id', async () => {
    const records = buildService(basicOrderRecords());
    const dto = pickupDto();

    await records.service.create('user-1', 'missing-item-id-key', dto);
    const completed = records.idempotencyRecords[0];
    const snapshot = completed?.responseSnapshot as
      { items?: Array<Record<string, unknown>> } | undefined;
    if (!snapshot?.items?.[0])
      throw new Error('Expected completed item snapshot');
    delete snapshot.items[0].id;

    await expect(
      records.service.create('user-1', 'missing-item-id-key', dto),
    ).rejects.toThrow('幂等记录已损坏');
  });

  it('treats cart item IDs as an order-independent multiset for completed replay', async () => {
    const records = buildService({
      ...basicOrderRecords(),
      cartItems: [
        { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 1 },
        { id: 'cart-2', userId: 'user-1', skuId: 'sku-1', quantity: 1 },
      ],
    });
    const first = await records.service.create(
      'user-1',
      'reordered-cart-key',
      pickupDto({ cartItemIds: ['cart-2', 'cart-1'] }),
    );
    records.orderRecords.length = 0;

    await expect(
      records.service.create(
        'user-1',
        'reordered-cart-key',
        pickupDto({ cartItemIds: ['cart-1', 'cart-2'] }),
      ),
    ).resolves.toEqual(first);
    expect(records.skuRecords[0]?.stock).toBe(3);
  });

  it('rejects the same key with a different complete request hash', async () => {
    const records = buildService(basicOrderRecords());
    await records.service.create(
      'user-1',
      'conflicting-key',
      pickupDto({ remark: '少糖' }),
    );

    await expect(
      records.service.create(
        'user-1',
        'conflicting-key',
        pickupDto({ remark: '正常糖' }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
      }),
    });
  });

  it('rejects an equal request while its idempotency record is IN_PROGRESS', async () => {
    const initial = basicOrderRecords();
    const records = buildService({
      ...initial,
      idempotency: [
        {
          id: 'idempotency-1',
          userId: 'user-1',
          operation: 'PRODUCT_ORDER_CREATE',
          key: 'in-progress-key',
          requestHash:
            '91d74b8433e2811bb99df6db2ceff1438cb69729258d109a8a1cc99efac7b97b',
          status: 'IN_PROGRESS',
          resourceType: null,
          resourceId: null,
          responseSnapshot: null,
          orderId: null,
        },
      ],
    });

    await expect(
      records.service.create('user-1', 'in-progress-key', pickupDto()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
      }),
    });
  });

  it.each([
    [
      'same raced request',
      {
        requestHash:
          '91d74b8433e2811bb99df6db2ceff1438cb69729258d109a8a1cc99efac7b97b',
        status: 'IN_PROGRESS',
      },
      ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
    ],
    [
      'different raced request',
      { requestHash: 'different-hash', status: 'IN_PROGRESS' },
      ApiErrorCode.IDEMPOTENCY_CONFLICT,
    ],
  ])('classifies ER_DUP_ENTRY for a %s', async (_name, raced, code) => {
    const records = buildService({
      ...basicOrderRecords(),
      idempotencyInsertError: { code: 'ER_DUP_ENTRY' },
      idempotencyAfterInsertError: {
        id: 'raced-idempotency',
        userId: 'user-1',
        operation: 'PRODUCT_ORDER_CREATE',
        key: 'raced-key',
        ...raced,
        resourceType: null,
        resourceId: null,
        responseSnapshot: null,
        orderId: null,
      },
    });

    await expect(
      records.service.create('user-1', 'raced-key', pickupDto()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code }),
    });
    expect(records.orderRecords).toHaveLength(0);
    expect(records.skuRecords[0]?.stock).toBe(5);
  });

  it('reclaims a FAILED record with the same hash and completes the retry', async () => {
    const failed = {
      id: 'failed-idempotency',
      userId: 'user-1',
      operation: 'PRODUCT_ORDER_CREATE',
      key: 'failed-retry-key',
      requestHash:
        '91d74b8433e2811bb99df6db2ceff1438cb69729258d109a8a1cc99efac7b97b',
      status: 'FAILED',
      resourceType: null,
      resourceId: null,
      responseSnapshot: null,
      orderId: null,
    };
    const records = buildService({
      ...basicOrderRecords(),
      idempotency: [failed],
      idempotencyInsertError: { code: 'ER_DUP_ENTRY' },
    });

    await expect(
      records.service.create('user-1', 'failed-retry-key', pickupDto()),
    ).resolves.toMatchObject({ id: expect.any(String) });
    expect(failed).toMatchObject({
      status: 'COMPLETED',
      resourceType: 'ORDER',
      resourceId: expect.any(String),
      responseSnapshot: expect.objectContaining({ id: expect.any(String) }),
    });
  });

  it('rejects a FAILED record when its hash differs', async () => {
    const records = buildService({
      ...basicOrderRecords(),
      idempotency: [
        {
          id: 'failed-idempotency',
          userId: 'user-1',
          operation: 'PRODUCT_ORDER_CREATE',
          key: 'failed-conflict-key',
          requestHash: 'different-hash',
          status: 'FAILED',
          responseSnapshot: null,
        },
      ],
    });

    await expect(
      records.service.create('user-1', 'failed-conflict-key', pickupDto()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
      }),
    });
    expect(records.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      'missing snapshot',
      { resourceType: 'ORDER', resourceId: 'order-1', responseSnapshot: null },
    ],
    [
      'wrong resource type',
      {
        resourceType: 'MEMBERSHIP',
        resourceId: 'order-1',
        responseSnapshot: {},
      },
    ],
    [
      'missing resource id',
      { resourceType: 'ORDER', resourceId: null, responseSnapshot: {} },
    ],
    [
      'empty snapshot',
      {
        resourceType: 'ORDER',
        resourceId: 'order-1',
        orderId: 'order-1',
        responseSnapshot: {},
      },
    ],
    [
      'snapshot id differs from resource id',
      {
        resourceType: 'ORDER',
        resourceId: 'order-1',
        orderId: 'order-1',
        responseSnapshot: {
          id: 'order-2',
          orderNo: 'BM2026072500000001',
          status: OrderStatus.NEW,
          items: [],
        },
      },
    ],
    [
      'structurally incomplete snapshot',
      {
        resourceType: 'ORDER',
        resourceId: 'order-1',
        orderId: 'order-1',
        responseSnapshot: {
          id: 'order-1',
          orderNo: 'BM2026072500000001',
          status: OrderStatus.NEW,
          items: [],
        },
      },
    ],
    [
      'order id differs from resource id',
      {
        resourceType: 'ORDER',
        resourceId: 'order-1',
        orderId: 'order-2',
        responseSnapshot: {
          id: 'order-1',
          orderNo: 'BM2026072500000001',
          status: OrderStatus.NEW,
          items: [],
        },
      },
    ],
  ])(
    'rejects corrupt COMPLETED idempotency data with an internal error: %s',
    async (_name, corrupt) => {
      const records = buildService({
        ...basicOrderRecords(),
        idempotency: [
          {
            id: 'corrupt-idempotency',
            userId: 'user-1',
            operation: 'PRODUCT_ORDER_CREATE',
            key: `corrupt-${_name}`,
            requestHash:
              '91d74b8433e2811bb99df6db2ceff1438cb69729258d109a8a1cc99efac7b97b',
            status: 'COMPLETED',
            ...corrupt,
          },
        ],
      });

      await expect(
        records.service.create('user-1', `corrupt-${_name}`, pickupDto()),
      ).rejects.toThrow('幂等记录已损坏');
    },
  );

  it('keeps the direct service path available for isolated non-pricing behavior tests', async () => {
    const records = buildService(basicOrderRecords());

    await expect(
      records.service.create('user-1', 'legacy-key', {
        cartItemIds: ['cart-1'],
        fulfillmentType: FulfillmentType.PICKUP,
        contactName: '张三',
        contactPhone: '13800000000',
        pickupTimeText: '明天 10:00',
      } as CreateOrderDto),
    ).resolves.toMatchObject({ id: expect.any(String) });
    expect(records.quoteTokens.verify).not.toHaveBeenCalled();
  });

  it.each([
    [
      'requested credit only',
      { requestedCreditCents: 0, quoteToken: undefined },
    ],
    [
      'quote token only',
      { requestedCreditCents: undefined, quoteToken: 'token' },
    ],
    ['both null', { requestedCreditCents: null, quoteToken: null }],
    [
      'null requested credit',
      { requestedCreditCents: null, quoteToken: 'token' },
    ],
    ['null quote token', { requestedCreditCents: 0, quoteToken: null }],
    ['empty quote token', { requestedCreditCents: 0, quoteToken: '' }],
  ])('rejects %s before opening a transaction', async (_name, overrides) => {
    const records = buildService(basicOrderRecords());

    await expect(
      records.service.create(
        'user-1',
        `paired-fields-${_name}`,
        pickupDto(overrides as never) as CreateOrderDto,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.ORDER_QUOTE_STALE,
      }),
    });
    expect(records.transaction).not.toHaveBeenCalled();
    expect(records.orderRecords).toHaveLength(0);
    expect(records.skuRecords[0]?.stock).toBe(5);
  });

  it('applies the active membership discount on the legacy request without debiting credit', async () => {
    const account = {
      id: 'account-1',
      userId: 'user-1',
      activeMembershipId: 'membership-1',
      availableCreditCents: 2_000,
      version: 4,
    };
    const debitFifo = vi.fn();
    const records = buildService({
      ...basicOrderRecords(),
      memberAccounts: [account],
      memberships: [
        {
          id: 'membership-1',
          userId: 'user-1',
          status: 'ACTIVE',
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          endsAt: new Date('2030-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-25T00:00:00.000Z'),
          levelCode: 'GOLD',
          levelName: '鎏金会员',
          discountBasisPoints: 9_000,
        },
      ],
      credit: {
        lockOrCreateAccount: vi.fn().mockResolvedValue(account),
        debitFifo,
      },
    });

    const view = await records.service.create(
      'user-1',
      'legacy-active-member',
      pickupDto(),
    );

    expect(view).toMatchObject({
      goodsTotalCents: 6_800,
      membershipDiscountCents: 680,
      creditAppliedCents: 0,
      payableTotalCents: 6_120,
      membershipId: 'membership-1',
      membershipCode: 'GOLD',
      membershipName: '鎏金会员',
      membershipDiscountBasisPoints: 9_000,
    });
    expect(debitFifo).not.toHaveBeenCalled();
  });

  it('rejects a tampered quote token before opening a transaction', async () => {
    const quoteTokens = new OrderQuoteTokenService('x'.repeat(32), 300);
    const records = buildService({ ...basicOrderRecords(), quoteTokens });

    await expect(
      records.service.create(
        'user-1',
        'tampered-token',
        pickupDto({ requestedCreditCents: 0, quoteToken: 'tampered' }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.ORDER_QUOTE_STALE,
      }),
    });
    expect(records.transaction).not.toHaveBeenCalled();
    expect(records.orderRecords).toHaveLength(0);
    expect(records.skuRecords[0]?.stock).toBe(5);
  });

  it.each([
    [
      'requested credit differs',
      { requestedCreditCents: 400, cartItemIds: ['cart-1'] },
    ],
    [
      'cart item multiset differs',
      { requestedCreditCents: 500, cartItemIds: ['cart-1', 'cart-1'] },
    ],
  ])(
    'rejects a quote whose %s before opening a transaction',
    async (_name, dto) => {
      const quoteTokens = new OrderQuoteTokenService('x'.repeat(32), 300);
      const token = quoteTokens.issue({
        userId: 'user-1',
        cart: [
          {
            cartItemId: 'cart-1',
            skuId: 'sku-1',
            quantity: 1,
            stockVersion: 3,
          },
        ],
        requestedCreditCents: 500,
        membershipId: null,
        membershipVersion: null,
        accountVersion: null,
        pricingVersion: 1,
      }).token;
      const records = buildService({ ...basicOrderRecords(), quoteTokens });

      await expect(
        records.service.create(
          'user-1',
          `stale-intent-${_name}`,
          pickupDto({ ...dto, quoteToken: token }),
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: ApiErrorCode.ORDER_QUOTE_STALE,
        }),
      });
      expect(records.transaction).not.toHaveBeenCalled();
      expect(records.orderRecords).toHaveLength(0);
      expect(records.skuRecords[0]?.stock).toBe(5);
    },
  );

  it.each([
    ['pricing version', { pricingVersion: 2 }],
    [
      'SKU id',
      {
        cart: [
          {
            cartItemId: 'cart-1',
            skuId: 'sku-2',
            quantity: 1,
            stockVersion: 3,
          },
        ],
      },
    ],
    [
      'quantity',
      {
        cart: [
          {
            cartItemId: 'cart-1',
            skuId: 'sku-1',
            quantity: 2,
            stockVersion: 3,
          },
        ],
      },
    ],
    [
      'stock version',
      {
        cart: [
          {
            cartItemId: 'cart-1',
            skuId: 'sku-1',
            quantity: 1,
            stockVersion: 4,
          },
        ],
      },
    ],
    [
      'membership id',
      {
        membershipId: 'membership-1',
        membershipVersion: '2026-07-25T00:00:00.000Z',
      },
    ],
    ['membership version', { membershipVersion: '2026-07-25T00:00:00.000Z' }],
    ['account version', { accountVersion: 2 }],
  ])(
    'rejects a quoted order when the transaction-time %s differs without writing stock or orders',
    async (_name, payloadOverride) => {
      const quoteTokens = new OrderQuoteTokenService('x'.repeat(32), 300);
      const token = quoteTokens.issue({
        userId: 'user-1',
        cart: [
          {
            cartItemId: 'cart-1',
            skuId: 'sku-1',
            quantity: 1,
            stockVersion: 3,
          },
        ],
        requestedCreditCents: 0,
        membershipId: null,
        membershipVersion: null,
        accountVersion: null,
        pricingVersion: 1,
        ...payloadOverride,
      }).token;
      const records = buildService({ ...basicOrderRecords(), quoteTokens });

      await expect(
        records.service.create(
          'user-1',
          `transaction-stale-${_name}`,
          pickupDto({ requestedCreditCents: 0, quoteToken: token }),
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: ApiErrorCode.ORDER_QUOTE_STALE,
        }),
      });
      expect(records.skuRecords[0]).toMatchObject({
        stock: 5,
        stockVersion: 3,
      });
      expect(records.orderRecords).toHaveLength(0);
    },
  );

  it('rejects duplicate cart item ids in both the DTO and quote token as stale', async () => {
    const quoteTokens = new OrderQuoteTokenService('x'.repeat(32), 300);
    const token = quoteTokens.issue({
      userId: 'user-1',
      cart: [
        { cartItemId: 'cart-1', skuId: 'sku-1', quantity: 1, stockVersion: 3 },
        { cartItemId: 'cart-1', skuId: 'sku-1', quantity: 1, stockVersion: 3 },
      ],
      requestedCreditCents: 0,
      membershipId: null,
      membershipVersion: null,
      accountVersion: null,
      pricingVersion: 1,
    }).token;
    const records = buildService({ ...basicOrderRecords(), quoteTokens });

    await expect(
      records.service.create(
        'user-1',
        'duplicate-cart-ids',
        pickupDto({
          cartItemIds: ['cart-1', 'cart-1'],
          requestedCreditCents: 0,
          quoteToken: token,
        }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.ORDER_QUOTE_STALE,
      }),
    });
    expect(records.transaction).not.toHaveBeenCalled();
    expect(records.skuRecords[0]?.stock).toBe(5);
    expect(records.orderRecords).toHaveLength(0);
  });

  it('applies the active membership line discount, caps credit, debits FIFO, and maps the complete snapshot', async () => {
    const updatedAt = new Date('2026-07-25T00:00:00.000Z');
    const account = {
      id: 'account-1',
      userId: 'user-1',
      activeMembershipId: 'membership-1',
      availableCreditCents: 2_000,
      version: 4,
    };
    const debitFifo = vi.fn().mockResolvedValue({
      account: { ...account, availableCreditCents: 0, version: 5 },
      entry: { id: 'entry-1' },
      allocations: [{ id: 'allocation-1' }],
    });
    const credit = {
      lockOrCreateAccount: vi.fn().mockResolvedValue(account),
      debitFifo,
    };
    const quoteTokens = new OrderQuoteTokenService('x'.repeat(32), 300);
    const token = quoteTokens.issue({
      userId: 'user-1',
      cart: [
        { cartItemId: 'cart-1', skuId: 'sku-1', quantity: 1, stockVersion: 3 },
      ],
      requestedCreditCents: 9_000,
      membershipId: 'membership-1',
      membershipVersion: updatedAt.toISOString(),
      accountVersion: 4,
      pricingVersion: 1,
    }).token;
    const records = buildService({
      ...basicOrderRecords(),
      memberAccounts: [account],
      memberships: [
        {
          id: 'membership-1',
          userId: 'user-1',
          status: 'ACTIVE',
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          endsAt: new Date('2030-01-01T00:00:00.000Z'),
          updatedAt,
          levelCode: 'GOLD',
          levelName: '鎏金会员',
          discountBasisPoints: 9_000,
        },
      ],
      quoteTokens,
      credit,
    });

    const view = await records.service.create(
      'user-1',
      'member-priced-order',
      pickupDto({ requestedCreditCents: 9_000, quoteToken: token }),
    );

    expect(records.orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        goodsTotalCents: 6_800,
        membershipDiscountCents: 680,
        creditAppliedCents: 2_000,
        payableTotalCents: 4_120,
        membershipId: 'membership-1',
        membershipCode: 'GOLD',
        membershipName: '鎏金会员',
        membershipDiscountBasisPoints: 9_000,
        pricingVersion: 1,
      }),
    );
    expect(debitFifo).toHaveBeenCalledWith(
      expect.anything(),
      account,
      expect.objectContaining({
        amountCents: 2_000,
        referenceType: 'PRODUCT_ORDER',
        referenceId: view.id,
        operationKey: `product-order-debit:${view.id}`,
      }),
    );
    expect(view).toMatchObject({
      goodsTotalCents: 6_800,
      membershipDiscountCents: 680,
      creditAppliedCents: 2_000,
      payableTotalCents: 4_120,
      membershipId: 'membership-1',
      membershipCode: 'GOLD',
      membershipName: '鎏金会员',
      membershipDiscountBasisPoints: 9_000,
      pricingVersion: 1,
      items: [
        expect.objectContaining({
          lineGoodsTotalCents: 6_800,
          lineMembershipDiscountCents: 680,
          linePayableCents: 6_120,
        }),
      ],
    });
  });

  it('uses no membership discount for an expired membership but still applies available credit', async () => {
    const updatedAt = new Date('2026-07-25T00:00:00.000Z');
    const account = {
      id: 'account-1',
      userId: 'user-1',
      activeMembershipId: 'membership-1',
      availableCreditCents: 500,
      version: 4,
    };
    const debitFifo = vi
      .fn()
      .mockResolvedValue({ account, entry: {}, allocations: [] });
    const credit = {
      lockOrCreateAccount: vi.fn().mockResolvedValue(account),
      debitFifo,
    };
    const quoteTokens = new OrderQuoteTokenService('x'.repeat(32), 300);
    const token = quoteTokens.issue({
      userId: 'user-1',
      cart: [
        { cartItemId: 'cart-1', skuId: 'sku-1', quantity: 1, stockVersion: 3 },
      ],
      requestedCreditCents: 500,
      membershipId: null,
      membershipVersion: null,
      accountVersion: 4,
      pricingVersion: 1,
    }).token;
    const records = buildService({
      ...basicOrderRecords(),
      memberAccounts: [account],
      memberships: [
        {
          id: 'membership-1',
          status: 'ACTIVE',
          startsAt: new Date('2020-01-01T00:00:00.000Z'),
          endsAt: new Date('2021-01-01T00:00:00.000Z'),
          updatedAt,
          discountBasisPoints: 5_000,
        },
      ],
      quoteTokens,
      credit,
    });

    const view = await records.service.create(
      'user-1',
      'expired-member-credit',
      pickupDto({ requestedCreditCents: 500, quoteToken: token }),
    );

    expect(view).toMatchObject({
      membershipDiscountCents: 0,
      creditAppliedCents: 500,
      payableTotalCents: 6_300,
    });
    expect(view).not.toHaveProperty('membershipId');
    expect(debitFifo).toHaveBeenCalledTimes(1);
  });

  it('aggregates two cart rows for one SKU into one stock reservation while retaining two order item rows', async () => {
    const records = buildService({
      ...basicOrderRecords(),
      cartItems: [
        { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 2 },
        { id: 'cart-2', userId: 'user-1', skuId: 'sku-1', quantity: 3 },
      ],
    });

    const view = await records.service.create(
      'user-1',
      'aggregate-stock',
      pickupDto({ cartItemIds: ['cart-2', 'cart-1'] }),
    );

    expect(records.skuRecords[0]).toMatchObject({ stock: 0, stockVersion: 4 });
    expect(view.items).toHaveLength(2);
    expect(view.items.map(({ quantity }) => quantity).sort()).toEqual([2, 3]);
  });

  it('rolls back stock and order writes when FIFO debit reports a concurrent insufficient balance', async () => {
    const account = {
      id: 'account-1',
      userId: 'user-1',
      activeMembershipId: null,
      availableCreditCents: 500,
      version: 4,
    };
    const credit = {
      lockOrCreateAccount: vi.fn().mockResolvedValue(account),
      debitFifo: vi.fn().mockRejectedValue(
        new ConflictException({
          code: ApiErrorCode.MEMBER_CREDIT_INSUFFICIENT,
          message: '消费金余额不足',
        }),
      ),
    };
    const quoteTokens = new OrderQuoteTokenService('x'.repeat(32), 300);
    const token = quoteTokens.issue({
      userId: 'user-1',
      cart: [
        { cartItemId: 'cart-1', skuId: 'sku-1', quantity: 1, stockVersion: 3 },
      ],
      requestedCreditCents: 500,
      membershipId: null,
      membershipVersion: null,
      accountVersion: 4,
      pricingVersion: 1,
    }).token;
    const records = buildService({
      ...basicOrderRecords(),
      memberAccounts: [account],
      quoteTokens,
      credit,
    });

    await expect(
      records.service.create(
        'user-1',
        'concurrent-insufficient-credit',
        pickupDto({ requestedCreditCents: 500, quoteToken: token }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.MEMBER_CREDIT_INSUFFICIENT,
      }),
    });
    expect(records.skuRecords[0]).toMatchObject({ stock: 5, stockVersion: 3 });
    expect(records.orderRecords).toHaveLength(0);
    expect(records.cartRecords).toHaveLength(1);
    expect(records.idempotencyRecords).toHaveLength(0);
  });

  it('creates a non-member order with internally consistent pricing snapshots', async () => {
    const records = buildService({
      users: [{ id: 'user-1', phone: '13800000000', phoneVerified: true }],
      products: [
        { id: 'product-1', name: '草莓蛋糕', isActive: true },
        { id: 'product-2', name: '巧克力曲奇', isActive: true },
      ],
      skus: [
        {
          id: 'sku-1',
          productId: 'product-1',
          name: '6寸',
          attributes: { size: '6寸' },
          priceCents: 6_800,
          stock: 3,
          isActive: true,
        },
        {
          id: 'sku-2',
          productId: 'product-2',
          name: '12片',
          attributes: { count: '12片' },
          priceCents: 2_500,
          stock: 4,
          isActive: true,
        },
      ],
      cartItems: [
        { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 2 },
        { id: 'cart-2', userId: 'user-1', skuId: 'sku-2', quantity: 3 },
      ],
    });

    await records.service.create('user-1', 'pricing-snapshot-key', {
      cartItemIds: ['cart-1', 'cart-2'],
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: '张三',
      contactPhone: '13800000000',
      pickupTimeText: '明天 10:00',
    });

    const goodsTotalCents = 6_800 * 2 + 2_500 * 3;
    expect(records.orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        goodsTotalCents,
        membershipDiscountCents: 0,
        creditAppliedCents: 0,
        payableTotalCents: goodsTotalCents,
        pricingVersion: 1,
      }),
    );
    expect(records.orderItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        unitPriceCents: 6_800,
        quantity: 2,
        lineGoodsTotalCents: 13_600,
        lineMembershipDiscountCents: 0,
        linePayableCents: 13_600,
      }),
    );
    expect(records.orderItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        unitPriceCents: 2_500,
        quantity: 3,
        lineGoodsTotalCents: 7_500,
        lineMembershipDiscountCents: 0,
        linePayableCents: 7_500,
      }),
    );
  });

  it('scopes product order idempotency by operation from lookup through completion', async () => {
    const membershipRecord = {
      id: 'membership-idempotency',
      userId: 'user-1',
      operation: 'MEMBERSHIP_PURCHASE_CREATE',
      key: 'shared-operation-key',
      orderId: null,
    };
    const records = buildService({
      users: [{ id: 'user-1', phone: '13800000000', phoneVerified: true }],
      products: [{ id: 'product-1', name: '草莓蛋糕', isActive: true }],
      skus: [
        {
          id: 'sku-1',
          productId: 'product-1',
          name: '6寸',
          attributes: { size: '6寸' },
          priceCents: 6_800,
          stock: 3,
          isActive: true,
        },
      ],
      cartItems: [
        { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 1 },
      ],
      idempotency: [membershipRecord],
    });

    const order = await records.service.create(
      'user-1',
      'shared-operation-key',
      {
        cartItemIds: ['cart-1'],
        fulfillmentType: FulfillmentType.PICKUP,
        contactName: '张三',
        contactPhone: '13800000000',
        pickupTimeText: '明天 10:00',
      },
    );

    expect(membershipRecord.orderId).toBeNull();
    expect(records.idempotencyRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-1',
          operation: 'PRODUCT_ORDER_CREATE',
          key: 'shared-operation-key',
          orderId: order.id,
        }),
      ]),
    );
    expect(records.idempotencyRecords).toHaveLength(2);
  });

  it('increments stockVersion exactly once with a successful stock decrement', async () => {
    const records = buildService({
      users: [{ id: 'user-1', phone: '13800000000', phoneVerified: true }],
      products: [{ id: 'product-1', isActive: true }],
      skus: [
        {
          id: 'sku-1',
          productId: 'product-1',
          name: '6寸',
          priceCents: 6800,
          stock: 3,
          stockVersion: 7,
          isActive: true,
        },
      ],
      cartItems: [
        { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 2 },
      ],
    });

    await records.service.create('user-1', 'version-key', {
      cartItemIds: ['cart-1'],
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: '张三',
      contactPhone: '13800000000',
      pickupTimeText: '明天 10:00',
    });

    expect(records.skuRecords[0]).toMatchObject({ stock: 1, stockVersion: 8 });
  });

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
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.STOCK_INSUFFICIENT,
      }),
    });
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
      products: [{ id: 'product-1', name: '草莓蛋糕', isActive: true }],
      skus: [
        {
          id: 'sku-1',
          productId: 'product-1',
          name: '6寸',
          attributes: { size: '6寸' },
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

  it('filters and paginates the lightweight admin order list', async () => {
    const createdAt = new Date('2026-07-18T08:00:00.000Z');
    const { service } = buildService({
      orders: [
        {
          id: 'order-1',
          orderNo: 'BM2026071800000001',
          status: OrderStatus.NEW,
          fulfillmentType: FulfillmentType.PICKUP,
          contactName: 'Alice',
          contactPhone: '13800000000',
          goodsTotalCents: 6800,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: 'order-2',
          orderNo: 'BM2026071800000002',
          status: OrderStatus.PROCESSING,
          fulfillmentType: FulfillmentType.DELIVERY,
          contactName: 'Bob',
          contactPhone: '13900000000',
          goodsTotalCents: 8800,
          createdAt: new Date('2026-07-18T09:00:00.000Z'),
          updatedAt: new Date('2026-07-18T09:00:00.000Z'),
        },
      ],
      orderItems: [
        {
          id: 'item-1',
          orderId: 'order-2',
          productName: '不应加载的详情',
        },
      ],
    });
    const query: AdminOrderListQuery = {
      orderNo: '0002',
      status: OrderStatus.PROCESSING,
      fulfillmentType: FulfillmentType.DELIVERY,
      createdAtFrom: '2026-07-18T08:30:00.000Z',
      createdAtBefore: '2026-07-19T00:00:00.000Z',
      page: 1,
      pageSize: 20,
    };

    await expect(service.listAll(query)).resolves.toEqual({
      items: [
        {
          id: 'order-2',
          orderNo: 'BM2026071800000002',
          status: OrderStatus.PROCESSING,
          fulfillmentType: FulfillmentType.DELIVERY,
          contactName: 'Bob',
          contactPhone: '13900000000',
          goodsTotalCents: 8800,
          createdAt: '2026-07-18T09:00:00.000Z',
          updatedAt: '2026-07-18T09:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });

  it('orders admin pagination by createdAt DESC and id DESC', async () => {
    const { service, orderQuerySpies } = buildService({ orders: [] });

    await service.listAll({ page: 1, pageSize: 20 });

    expect(orderQuerySpies.orderBy).toHaveBeenCalledWith(
      'order.createdAt',
      'DESC',
    );
    expect(orderQuerySpies.addOrderBy).toHaveBeenCalledWith('order.id', 'DESC');
  });

  it.each([
    ['percent', '%', '%\\%%'],
    ['underscore', '_', '%\\_%'],
    ['backslash', '\\', '%\\\\%'],
    ['mixed', 'A%_\\B', '%A\\%\\_\\\\B%'],
  ])(
    'escapes %s in literal order number substring searches',
    async (_name, orderNo, expectedPattern) => {
      const { service, orderQuerySpies } = buildService({ orders: [] });

      await service.listAll({ orderNo, page: 1, pageSize: 20 });

      expect(orderQuerySpies.andWhere).toHaveBeenCalledWith(
        "order.orderNo LIKE :orderNo ESCAPE '\\\\'",
        { orderNo: expectedPattern },
      );
    },
  );

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

  it('rejects a same-status request as an invalid transition', async () => {
    const { service } = buildService({
      adminUsers: [{ id: 'admin-1', isActive: true }],
      orders: [
        {
          id: 'order-1',
          orderNo: 'BM2026010100000001',
          status: OrderStatus.COMPLETED,
          fulfillmentType: FulfillmentType.PICKUP,
          contactName: 'Alice',
          contactPhone: '13800000000',
          goodsTotalCents: 1000,
          createdAt: new Date('2026-07-18T00:00:00.000Z'),
          updatedAt: new Date('2026-07-18T00:00:00.000Z'),
        },
      ],
    });

    await expect(
      service.updateStatus('order-1', OrderStatus.COMPLETED, 'admin-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.INVALID_ORDER_TRANSITION,
      }),
    });
  });

  it('locks the user and account before the order when cancelling credited orders', async () => {
    const lockOrder: string[] = [];
    const account = {
      id: 'account-1',
      userId: 'user-1',
      activeMembershipId: null,
      availableCreditCents: 500,
      version: 4,
    };
    const records = buildService({
      users: [{ id: 'user-1', phone: '13800000000', phoneVerified: true }],
      memberAccounts: [account],
      creditEntries: [
        {
          id: 'debit-entry-1',
          accountId: account.id,
          direction: 'DEBIT',
          type: 'PRODUCT_ORDER_DEBIT',
          amountCents: 500,
          referenceType: 'PRODUCT_ORDER',
          referenceId: 'order-1',
          operationKey: 'product-order-debit:order-1',
        },
      ],
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
          goodsTotalCents: 1_000,
          membershipDiscountCents: 0,
          creditAppliedCents: 500,
          payableTotalCents: 500,
          pricingVersion: 1,
          remark: null,
          createdAt: new Date('2026-07-25T00:00:00.000Z'),
          updatedAt: new Date('2026-07-25T00:00:00.000Z'),
        },
      ],
      credit: {
        lockOrCreateAccount: vi.fn().mockImplementation(async () => {
          lockOrder.push('account');
          return account;
        }),
        debitFifo: vi.fn(),
        reverseDebit: vi.fn().mockImplementation(async () => {
          lockOrder.push('reverseDebit');
          return { account, entry: {}, allocations: [] };
        }),
      },
    });
    type TestManager = {
      getRepository: (entity: { name: string }) => {
        findOne: (options: {
          lock?: unknown;
          where: unknown;
        }) => Promise<unknown>;
      } & Record<string, unknown>;
    };
    const originalTransaction = records.transaction.getMockImplementation();
    records.transaction.mockImplementation(async (callback) =>
      originalTransaction!(async (unknownManager: unknown) => {
        const manager = unknownManager as TestManager;
        const originalGetRepository = manager.getRepository;
        manager.getRepository = (entity: { name: string }) => {
          const repo = originalGetRepository(entity);
          const originalFindOne = repo.findOne;
          repo.findOne = async (options: {
            lock?: unknown;
            where: unknown;
          }) => {
            if (options.lock && entity.name === 'User') lockOrder.push('user');
            if (options.lock && entity.name === 'Order')
              lockOrder.push('order');
            if (options.lock && entity.name === 'MemberCreditEntry') {
              lockOrder.push('entry');
            }
            return originalFindOne(options);
          };
          return repo;
        };
        return callback(manager);
      }),
    );

    await records.service.updateStatus(
      'order-1',
      OrderStatus.CANCELLED,
      'admin-1',
    );

    expect(lockOrder).toEqual(['user', 'account', 'order', 'reverseDebit']);
  });

  it.each([
    ['accountId', { accountId: 'account-other' }],
    ['type', { type: 'MEMBERSHIP_PURCHASE_GRANT' }],
    ['referenceType', { referenceType: 'MEMBERSHIP_PURCHASE' }],
    ['referenceId', { referenceId: 'order-other' }],
    ['amountCents', { amountCents: 499 }],
  ])(
    'rejects cancellation when the original debit %s does not match the order',
    async (_field, entryOverride) => {
      const account = {
        id: 'account-1',
        userId: 'user-1',
        activeMembershipId: null,
        availableCreditCents: 500,
        version: 4,
      };
      const reverseDebit = vi.fn();
      const records = buildService({
        users: [{ id: 'user-1', phone: '13800000000', phoneVerified: true }],
        memberAccounts: [account],
        creditEntries: [
          {
            id: 'debit-entry-1',
            accountId: account.id,
            direction: 'DEBIT',
            type: 'PRODUCT_ORDER_DEBIT',
            amountCents: 500,
            referenceType: 'PRODUCT_ORDER',
            referenceId: 'order-1',
            operationKey: 'product-order-debit:order-1',
            ...entryOverride,
          },
        ],
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
            goodsTotalCents: 1_000,
            membershipDiscountCents: 0,
            creditAppliedCents: 500,
            payableTotalCents: 500,
            pricingVersion: 1,
            remark: null,
            createdAt: new Date('2026-07-25T00:00:00.000Z'),
            updatedAt: new Date('2026-07-25T00:00:00.000Z'),
          },
        ],
        credit: {
          lockOrCreateAccount: vi.fn().mockResolvedValue(account),
          debitFifo: vi.fn(),
          reverseDebit,
        },
      });

      await expect(
        records.service.updateStatus(
          'order-1',
          OrderStatus.CANCELLED,
          'admin-1',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MEMBER_CREDIT_INCONSISTENT',
        }),
      });

      expect(reverseDebit).not.toHaveBeenCalled();
      expect(records.orderRecords[0]?.status).toBe(OrderStatus.PROCESSING);
      expect(records.auditRecords).toHaveLength(0);
    },
  );

  it('reverses exactly this order credit in the cancellation transaction without restocking', async () => {
    const account = {
      id: 'account-1',
      userId: 'user-1',
      activeMembershipId: null,
      availableCreditCents: 500,
      version: 4,
    };
    const debitEntry = {
      id: 'debit-entry-1',
      accountId: account.id,
      direction: 'DEBIT',
      type: 'PRODUCT_ORDER_DEBIT',
      amountCents: 500,
      referenceType: 'PRODUCT_ORDER',
      referenceId: 'order-1',
      operationKey: 'product-order-debit:order-1',
    };
    const reverseDebit = vi.fn().mockResolvedValue({
      account: { ...account, availableCreditCents: 1_000, version: 5 },
      entry: { id: 'reversal-entry-1' },
      allocations: [{ id: 'reversal-allocation-1' }],
    });
    const records = buildService({
      ...basicOrderRecords(),
      memberAccounts: [account],
      creditEntries: [debitEntry],
      credit: {
        lockOrCreateAccount: vi.fn().mockResolvedValue(account),
        debitFifo: vi.fn(),
        reverseDebit,
      },
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
          goodsTotalCents: 1_000,
          membershipDiscountCents: 0,
          creditAppliedCents: 500,
          payableTotalCents: 500,
          pricingVersion: 1,
          remark: null,
          createdAt: new Date('2026-07-25T00:00:00.000Z'),
          updatedAt: new Date('2026-07-25T00:00:00.000Z'),
        },
      ],
    });

    const result = await records.service.updateStatus(
      'order-1',
      OrderStatus.CANCELLED,
      'admin-1',
    );

    expect(reverseDebit).toHaveBeenCalledWith(expect.anything(), account, {
      originalEntryId: debitEntry.id,
      referenceType: 'PRODUCT_ORDER',
      referenceId: 'order-1',
      operationKey: 'product-order-cancel:order-1',
    });
    expect(records.transaction).toHaveBeenCalledTimes(1);
    expect(records.skuRecords[0]).toMatchObject({ stock: 5, stockVersion: 3 });
    expect(result).toMatchObject({
      order: { status: OrderStatus.CANCELLED },
      noRestock: true,
    });
  });

  it('rejects repeated cancellation without reversing the order credit twice', async () => {
    const account = {
      id: 'account-1',
      userId: 'user-1',
      activeMembershipId: null,
      availableCreditCents: 500,
      version: 4,
    };
    const reverseDebit = vi.fn().mockResolvedValue({
      account: { ...account, availableCreditCents: 1_000, version: 5 },
      entry: { id: 'reversal-entry-1' },
      allocations: [],
    });
    const records = buildService({
      users: [{ id: 'user-1', phone: '13800000000', phoneVerified: true }],
      memberAccounts: [account],
      creditEntries: [
        {
          id: 'debit-entry-1',
          accountId: account.id,
          direction: 'DEBIT',
          type: 'PRODUCT_ORDER_DEBIT',
          amountCents: 500,
          referenceType: 'PRODUCT_ORDER',
          referenceId: 'order-1',
          operationKey: 'product-order-debit:order-1',
        },
      ],
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
          goodsTotalCents: 1_000,
          membershipDiscountCents: 0,
          creditAppliedCents: 500,
          payableTotalCents: 500,
          pricingVersion: 1,
          remark: null,
          createdAt: new Date('2026-07-25T00:00:00.000Z'),
          updatedAt: new Date('2026-07-25T00:00:00.000Z'),
        },
      ],
      credit: {
        lockOrCreateAccount: vi.fn().mockResolvedValue(account),
        debitFifo: vi.fn(),
        reverseDebit,
      },
    });

    await records.service.updateStatus(
      'order-1',
      OrderStatus.CANCELLED,
      'admin-1',
    );
    await expect(
      records.service.updateStatus('order-1', OrderStatus.CANCELLED, 'admin-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.INVALID_ORDER_TRANSITION,
      }),
    });

    expect(reverseDebit).toHaveBeenCalledTimes(1);
  });

  it('rolls back credit reversal and order cancellation when audit persistence fails', async () => {
    const account = {
      id: 'account-1',
      userId: 'user-1',
      activeMembershipId: null,
      availableCreditCents: 500,
      version: 4,
    };
    const records = buildService({
      users: [{ id: 'user-1', phone: '13800000000', phoneVerified: true }],
      memberAccounts: [account],
      creditEntries: [
        {
          id: 'debit-entry-1',
          accountId: account.id,
          direction: 'DEBIT',
          type: 'PRODUCT_ORDER_DEBIT',
          amountCents: 500,
          referenceType: 'PRODUCT_ORDER',
          referenceId: 'order-1',
          operationKey: 'product-order-debit:order-1',
        },
      ],
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
          goodsTotalCents: 1_000,
          membershipDiscountCents: 0,
          creditAppliedCents: 500,
          payableTotalCents: 500,
          pricingVersion: 1,
          remark: null,
          createdAt: new Date('2026-07-25T00:00:00.000Z'),
          updatedAt: new Date('2026-07-25T00:00:00.000Z'),
        },
      ],
      credit: {
        lockOrCreateAccount: vi.fn().mockResolvedValue(account),
        debitFifo: vi.fn(),
        reverseDebit: vi.fn().mockImplementation(async () => {
          account.availableCreditCents = 1_000;
          return { account, entry: {}, allocations: [] };
        }),
      },
      auditRecordError: new Error('audit failed'),
    });

    await expect(
      records.service.updateStatus('order-1', OrderStatus.CANCELLED, 'admin-1'),
    ).rejects.toThrow('audit failed');

    expect(records.orderRecords[0]?.status).toBe(OrderStatus.PROCESSING);
    expect(records.memberAccountRecords[0]?.availableCreditCents).toBe(500);
    expect(records.transaction).toHaveBeenCalledTimes(1);
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
        {
          id: '1',
          userId: 'user-1',
          operation: 'PRODUCT_ORDER_CREATE',
          key: 'collide',
          orderId: null,
        },
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
