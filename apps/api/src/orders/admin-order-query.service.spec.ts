import 'reflect-metadata';

import {
  AdminOrderSupplyMatchType,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';
import { BadRequestException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import { OrdersModule } from './orders.module.js';
import { AdminOrderQueryService } from './admin-order-query.service.js';

function queryBuilderMock(options: {
  rawMany?: readonly Record<string, unknown>[];
  rawOne?: Record<string, unknown>;
}) {
  const builder = {
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    select: vi.fn(),
    addSelect: vi.fn(),
    where: vi.fn(),
    andWhere: vi.fn(),
    groupBy: vi.fn(),
    orderBy: vi.fn(),
    addOrderBy: vi.fn(),
    offset: vi.fn(),
    limit: vi.fn(),
    getRawMany: vi.fn().mockResolvedValue(options.rawMany ?? []),
    getRawOne: vi.fn().mockResolvedValue(options.rawOne),
  };
  [
    builder.innerJoin,
    builder.leftJoin,
    builder.select,
    builder.addSelect,
    builder.where,
    builder.andWhere,
    builder.groupBy,
    builder.orderBy,
    builder.addOrderBy,
    builder.offset,
    builder.limit,
  ].forEach((method) => method.mockReturnValue(builder));
  return builder;
}

function repositoryMock(builders: ReturnType<typeof queryBuilderMock>[]) {
  return {
    createQueryBuilder: vi
      .fn()
      .mockImplementation(() => builders.shift() as never),
  };
}

describe('AdminOrderQueryService', () => {
  it('is registered by OrdersModule', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      OrdersModule,
    ) as unknown[] | undefined;

    expect(providers).toContain(AdminOrderQueryService);
  });

  it('maps a database-paged SKU summary and applies stable SQL ordering', async () => {
    const summary = queryBuilderMock({
      rawMany: [
        {
          groupKey: 'sku:11',
          productId: '7',
          skuId: '11',
          productName: '草莓蛋糕',
          skuName: '6寸',
          skuAttributes: '{"size":"6寸"}',
          requiredQuantity: '18',
          orderCount: '12',
          newQuantity: '10',
          processingQuantity: '8',
          remainingSaleableStock: '23',
          earliestOrderCreatedAt: new Date('2026-07-20T01:02:03.000Z'),
        },
      ],
    });
    const count = queryBuilderMock({ rawOne: { total: '2' } });
    const repository = repositoryMock([summary, count]);
    const service = new AdminOrderQueryService(repository as never);

    const result = await service.listSupply({
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      itemQ: '草莓',
      page: 2,
      pageSize: 1,
    });

    expect(result).toEqual({
      items: [
        {
          groupKey: 'sku:11',
          matchType: AdminOrderSupplyMatchType.SKU_ID,
          productId: '7',
          skuId: '11',
          productName: '草莓蛋糕',
          skuName: '6寸',
          skuAttributes: { size: '6寸' },
          requiredQuantity: 18,
          orderCount: 12,
          newQuantity: 10,
          processingQuantity: 8,
          remainingSaleableStock: 23,
          earliestOrderCreatedAt: '2026-07-20T01:02:03.000Z',
        },
      ],
      page: 2,
      pageSize: 1,
      total: 2,
    });
    expect(summary.where).toHaveBeenCalledWith(
      'order.status IN (:...supplyStatuses)',
      { supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING] },
    );
    expect(summary.andWhere).toHaveBeenCalledWith(
      "(item.product_name LIKE :itemQ ESCAPE '\\\\' OR item.sku_name LIKE :itemQ ESCAPE '\\\\')",
      { itemQ: '%草莓%' },
    );
    expect(summary.orderBy).toHaveBeenCalledWith('requiredQuantity', 'DESC');
    expect(summary.addOrderBy).toHaveBeenNthCalledWith(
      1,
      'earliestOrderCreatedAt',
      'ASC',
    );
    expect(summary.addOrderBy).toHaveBeenNthCalledWith(2, 'groupKey', 'ASC');
    expect(summary.offset).toHaveBeenCalledWith(1);
    expect(summary.limit).toHaveBeenCalledWith(1);
    const summarySelections = new Map(
      summary.addSelect.mock.calls.map(([selection, alias]) => [
        String(alias),
        String(selection),
      ]),
    );
    for (const alias of [
      'productId',
      'skuId',
      'productName',
      'skuName',
      'skuAttributes',
    ]) {
      const selection = summarySelections.get(alias);
      expect(selection).toContain('JSON_EXTRACT(SUBSTRING_INDEX(MIN(CONCAT(');
      expect(selection).toContain(
        "DATE_FORMAT(order.created_at, '%Y-%m-%d %H:%i:%s')",
      );
      expect(selection).toContain("LPAD(order.id, 20, '0')");
      expect(selection).toContain("LPAD(item.id, 20, '0')");
      expect(selection?.replaceAll(/\s+/g, ' ')).toContain(
        'JSON_ARRAY(item.product_id, item.sku_id, item.product_name, item.sku_name, item.sku_attributes)',
      );
    }
    expect(String(count.select.mock.calls[0]?.[0])).toContain(
      'COUNT(DISTINCT CASE',
    );
  });

  it('maps a legacy fallback group without source IDs or live stock', async () => {
    const summary = queryBuilderMock({
      rawMany: [
        {
          groupKey: `legacy:${'a'.repeat(64)}`,
          productId: null,
          skuId: null,
          productName: '历史蛋糕',
          skuName: '旧规格',
          skuAttributes: { flavor: '奶油' },
          requiredQuantity: 3,
          orderCount: 2,
          newQuantity: 3,
          processingQuantity: 0,
          remainingSaleableStock: null,
          earliestOrderCreatedAt: '2026-07-19T00:00:00.000Z',
        },
      ],
    });
    const count = queryBuilderMock({ rawOne: { total: 1 } });
    const service = new AdminOrderQueryService(
      repositoryMock([summary, count]) as never,
    );

    const result = await service.listSupply({
      supplyStatuses: [OrderStatus.NEW],
      page: 1,
      pageSize: 20,
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        groupKey: `legacy:${'a'.repeat(64)}`,
        matchType: AdminOrderSupplyMatchType.LEGACY_FALLBACK,
        productName: '历史蛋糕',
      }),
    );
    expect(result.items[0]).not.toHaveProperty('productId');
    expect(result.items[0]).not.toHaveProperty('skuId');
    expect(result.items[0]).not.toHaveProperty('remainingSaleableStock');
  });

  it.each([OrderStatus.COMPLETED, OrderStatus.CANCELLED])(
    'rejects unsupported supply status %s even when called without DTO validation',
    async (status) => {
      const repository = repositoryMock([]);
      const service = new AdminOrderQueryService(repository as never);

      await expect(
        service.listSupply({
          supplyStatuses: [status] as never,
          page: 1,
          pageSize: 20,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    },
  );

  it('rejects an unsafe summary offset before passing it to TypeORM', async () => {
    const summary = queryBuilderMock({ rawMany: [] });
    const count = queryBuilderMock({ rawOne: { total: '0' } });
    const service = new AdminOrderQueryService(
      repositoryMock([summary, count]) as never,
    );

    await expect(
      service.listSupply({
        supplyStatuses: [OrderStatus.NEW],
        page: Number.MAX_SAFE_INTEGER,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(summary.offset).not.toHaveBeenCalled();
    expect(count.offset).not.toHaveBeenCalled();
  });

  it('rejects an unsafe detail offset before passing it to TypeORM', async () => {
    const items = queryBuilderMock({ rawMany: [] });
    const count = queryBuilderMock({ rawOne: { total: '0' } });
    const service = new AdminOrderQueryService(
      repositoryMock([items, count]) as never,
    );

    await expect(
      service.listSupplyItems({
        groupKey: 'sku:11',
        supplyStatuses: [OrderStatus.NEW],
        page: Number.MAX_SAFE_INTEGER,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(items.offset).not.toHaveBeenCalled();
    expect(count.offset).not.toHaveBeenCalled();
  });

  it('throws a clear error rather than truncating an unsafe aggregate', async () => {
    const summary = queryBuilderMock({
      rawMany: [
        {
          groupKey: 'sku:11',
          productId: '7',
          skuId: '11',
          productName: '草莓蛋糕',
          skuName: '6寸',
          skuAttributes: '{}',
          requiredQuantity: '9007199254740992',
          orderCount: '1',
          newQuantity: '9007199254740992',
          processingQuantity: '0',
          remainingSaleableStock: '1',
          earliestOrderCreatedAt: new Date('2026-07-20T00:00:00.000Z'),
        },
      ],
    });
    const count = queryBuilderMock({ rawOne: { total: '1' } });
    const service = new AdminOrderQueryService(
      repositoryMock([summary, count]) as never,
    );

    await expect(
      service.listSupply({
        supplyStatuses: [OrderStatus.NEW],
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow(
      'requiredQuantity exceeds Number.MAX_SAFE_INTEGER: 9007199254740992',
    );
  });

  it('adds a parameterized SKU index condition while retaining exact group matching', async () => {
    const items = queryBuilderMock({ rawMany: [] });
    const count = queryBuilderMock({ rawOne: { total: '0' } });
    const service = new AdminOrderQueryService(
      repositoryMock([items, count]) as never,
    );
    const groupSkuId = '9007199254740993123456789';
    const groupKey = `sku:${groupSkuId}`;

    await service.listSupplyItems({
      groupKey,
      supplyStatuses: [OrderStatus.NEW],
      page: 1,
      pageSize: 20,
    });

    for (const builder of [items, count]) {
      expect(builder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('= :groupKey'),
        { groupKey },
      );
      expect(builder.andWhere).toHaveBeenCalledWith(
        'item.sku_id = :groupSkuId',
        { groupSkuId },
      );
    }
  });

  it('matches an opaque groupKey exactly and returns complete ordered details', async () => {
    const items = queryBuilderMock({
      rawMany: [
        {
          orderItemId: '31',
          orderId: '21',
          orderNo: 'BM202607280001',
          status: OrderStatus.PROCESSING,
          fulfillmentType: FulfillmentType.DELIVERY,
          contactName: '张三',
          contactPhone: '13800000000',
          pickupTimeText: null,
          deliveryAddressText: '上海市 / 浦东新区',
          productId: '7',
          skuId: '11',
          productName: '草莓蛋糕',
          skuName: '6寸',
          skuAttributes: '{"size":"6寸"}',
          quantity: '2',
          unitPriceCents: '6800',
          lineGoodsTotalCents: '13600',
          lineMembershipDiscountCents: '1360',
          linePayableCents: '12240',
          remark: '少糖',
          orderCreatedAt: new Date('2026-07-20T01:02:03.000Z'),
        },
      ],
    });
    const count = queryBuilderMock({ rawOne: { total: '1' } });
    const service = new AdminOrderQueryService(
      repositoryMock([items, count]) as never,
    );
    const opaqueGroupKey = `legacy:${'f'.repeat(64)}`;

    const result = await service.listSupplyItems({
      groupKey: opaqueGroupKey,
      supplyStatuses: [OrderStatus.PROCESSING],
      page: 1,
      pageSize: 50,
    });

    expect(result).toEqual({
      items: [
        {
          orderItemId: '31',
          orderId: '21',
          orderNo: 'BM202607280001',
          status: OrderStatus.PROCESSING,
          fulfillmentType: FulfillmentType.DELIVERY,
          contactName: '张三',
          contactPhone: '13800000000',
          deliveryAddressText: '上海市 / 浦东新区',
          productId: '7',
          skuId: '11',
          productName: '草莓蛋糕',
          skuName: '6寸',
          skuAttributes: { size: '6寸' },
          quantity: 2,
          unitPriceCents: 6800,
          lineGoodsTotalCents: 13600,
          lineMembershipDiscountCents: 1360,
          linePayableCents: 12240,
          remark: '少糖',
          orderCreatedAt: '2026-07-20T01:02:03.000Z',
        },
      ],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    expect(items.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('= :groupKey'),
      { groupKey: opaqueGroupKey },
    );
    expect(items.andWhere).not.toHaveBeenCalledWith(
      'item.sku_id = :groupSkuId',
      expect.anything(),
    );
    expect(count.andWhere).not.toHaveBeenCalledWith(
      'item.sku_id = :groupSkuId',
      expect.anything(),
    );
    expect(items.orderBy).toHaveBeenCalledWith('order.created_at', 'ASC');
    expect(items.addOrderBy).toHaveBeenNthCalledWith(1, 'order.id', 'ASC');
    expect(items.addOrderBy).toHaveBeenNthCalledWith(2, 'item.id', 'ASC');
    expect(items.offset).toHaveBeenCalledWith(0);
    expect(items.limit).toHaveBeenCalledWith(50);
  });
});
