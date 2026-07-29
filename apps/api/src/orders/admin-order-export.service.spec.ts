import 'reflect-metadata';

import {
  AdminOrderExportView,
  AdminOrderSupplyMatchType,
  ApiErrorCode,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Workbook } from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AdminOrderExportService,
  aggregateSupplyDetails,
  safeExcelText,
} from './admin-order-export.service.js';
import { OrdersModule } from './orders.module.js';

const chainableQueryBuilder = (options: {
  count?: number;
  rows?: readonly Record<string, unknown>[];
}) => {
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
    getCount: vi.fn().mockResolvedValue(options.count ?? 0),
    getRawMany: vi.fn().mockResolvedValue(options.rows ?? []),
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
  ].forEach((method) => method.mockReturnValue(builder));
  return builder;
};

const createService = (
  builders: ReturnType<typeof chainableQueryBuilder>[],
  options: { onTransactionCallbackComplete?: () => void } = {},
) => {
  const repository = {
    createQueryBuilder: vi
      .fn()
      .mockImplementation(() => builders.shift() as never),
  };
  const manager = {
    getRepository: vi.fn().mockReturnValue(repository),
  };
  const transaction = vi.fn(
    async (
      _isolation: string,
      work: (entityManager: typeof manager) => Promise<unknown>,
    ) => {
      const result = await work(manager);
      options.onTransactionCallbackComplete?.();
      return result;
    },
  );
  return {
    service: new AdminOrderExportService({ transaction } as never),
    manager,
    repository,
    transaction,
  };
};

const loadWorkbook = async (buffer: Buffer): Promise<Workbook> => {
  const workbook = new Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
};

const xlsxPrototype = Object.getPrototypeOf(new Workbook().xlsx) as {
  writeBuffer: () => Promise<Buffer>;
};

const createSupplyDetail = (index: number) => ({
  groupKey: 'sku:11',
  orderItemId: String(index + 1),
  orderId: String(index + 1),
  orderNo: `BM${String(index + 1).padStart(12, '0')}`,
  status:
    index % 2 === 0
      ? (OrderStatus.NEW as const)
      : (OrderStatus.PROCESSING as const),
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '张三',
  contactPhone: '13800000000',
  pickupTimeText: '明天下午',
  productId: '7',
  skuId: '11',
  productName: '草莓蛋糕',
  skuName: '6寸',
  skuAttributes: { size: '6寸' },
  quantity: 1,
  unitPriceCents: 6800,
  lineGoodsTotalCents: 6800,
  lineMembershipDiscountCents: 0,
  linePayableCents: 6800,
  orderCreatedAt: new Date(1_700_000_000_000 + index).toISOString(),
  remainingSaleableStock: 23,
});

describe('AdminOrderExportService', () => {
  afterEach(() => {
    if (vi.isMockFunction(xlsxPrototype.writeBuffer)) {
      vi.mocked(xlsxPrototype.writeBuffer).mockRestore();
    }
  });

  it('is registered by OrdersModule', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      OrdersModule,
    ) as unknown[] | undefined;

    expect(providers).toContain(AdminOrderExportService);
  });

  it('exports every matching order as one safe and formatted worksheet row', async () => {
    const count = chainableQueryBuilder({ count: 1 });
    const rows = chainableQueryBuilder({
      rows: [
        {
          id: '9007199254740993',
          orderNo: '=HYPERLINK("https://example.invalid")',
          userId: '138000000000000001',
          status: OrderStatus.NEW,
          fulfillmentType: FulfillmentType.PICKUP,
          contactName: '+1',
          contactPhone: '013800000000',
          itemLineCount: '2',
          totalQuantity: '3',
          goodsTotalCents: '12345',
          membershipDiscountCents: '345',
          creditAppliedCents: '1000',
          payableTotalCents: '11000',
          pickupTimeText: '-1',
          deliveryAddressText: null,
          membershipCode: '@SUM',
          membershipName: '清新会员',
          membershipDiscountBasisPoints: '9000',
          remark: '少糖',
          createdAt: new Date('2026-07-28T01:02:03.000Z'),
          updatedAt: new Date('2026-07-28T02:03:04.000Z'),
        },
      ],
    });
    const { service, transaction, manager } = createService([count, rows]);

    const result = await service.export({
      view: AdminOrderExportView.ORDER,
      status: OrderStatus.NEW,
      itemQ: '蛋糕',
    });
    const workbook = await loadWorkbook(result.buffer);
    const worksheet = workbook.getWorksheet('订单列表');

    expect(transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
    expect(manager.getRepository).toHaveBeenCalledTimes(1);
    expect(count.andWhere).toHaveBeenCalledWith('order.status = :status', {
      status: OrderStatus.NEW,
    });
    expect(rows.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('EXISTS'),
      { itemQ: '%蛋糕%' },
    );
    expect(workbook.worksheets.map(({ name }) => name)).toEqual(['订单列表']);
    expect(worksheet?.rowCount).toBe(2);
    expect(worksheet?.views).toEqual([
      expect.objectContaining({ state: 'frozen', ySplit: 1 }),
    ]);
    expect(worksheet?.autoFilter).toBe('A1:S1');
    expect(worksheet?.getCell('A2').value).toBe(
      '\'=HYPERLINK("https://example.invalid")',
    );
    expect(worksheet?.getCell('C2').value).toBe("'+1");
    expect(worksheet?.getCell('M2').value).toBe("'-1");
    expect(worksheet?.getCell('N2').value).toBe("'@SUM");
    for (const address of ['A2', 'C2', 'M2', 'N2']) {
      expect(worksheet?.getCell(address).formula).toBeUndefined();
    }
    expect(worksheet?.getCell('B2').value).toBe('138000000000000001');
    expect(worksheet?.getCell('D2').value).toBe('013800000000');
    expect(worksheet?.getCell('A2').numFmt).toBe('@');
    expect(worksheet?.getCell('D2').numFmt).toBe('@');
    expect(worksheet?.getCell('I2').value).toBe(123.45);
    expect(worksheet?.getCell('I2').numFmt).toBe('¥#,##0.00');
    expect(worksheet?.getCell('L2').value).toBe(110);
    expect(result).toEqual(
      expect.objectContaining({
        filename: expect.stringMatching(/^订单列表_\d{8}_\d{6}\.xlsx$/),
        rowCount: 1,
      }),
    );
    expect(result.filename).not.toContain('013800000000');
  });

  it('derives the SKU summary from the same ordered detail rows and exports both sheets', async () => {
    const count = chainableQueryBuilder({ count: 2 });
    const rows = chainableQueryBuilder({
      rows: [
        {
          groupKey: 'sku:11',
          orderItemId: '31',
          orderId: '21',
          orderNo: 'BM202607280001',
          status: OrderStatus.NEW,
          fulfillmentType: FulfillmentType.DELIVERY,
          contactName: '张三',
          contactPhone: '13800000000',
          pickupTimeText: null,
          deliveryAddressText: '上海市浦东新区',
          productId: '7',
          skuId: '11',
          productName: '草莓蛋糕',
          skuName: '6寸',
          skuAttributes: '{"size":"6寸","flavor":"草莓"}',
          quantity: '2',
          unitPriceCents: '6800',
          lineGoodsTotalCents: '13600',
          lineMembershipDiscountCents: '1360',
          linePayableCents: '12240',
          remark: '少糖',
          orderCreatedAt: new Date('2026-07-28T01:02:03.000Z'),
          remainingSaleableStock: '23',
        },
        {
          groupKey: 'sku:11',
          orderItemId: '32',
          orderId: '22',
          orderNo: 'BM202607280002',
          status: OrderStatus.PROCESSING,
          fulfillmentType: FulfillmentType.PICKUP,
          contactName: '李四',
          contactPhone: '13900000000',
          pickupTimeText: '明天下午',
          deliveryAddressText: null,
          productId: '7',
          skuId: '11',
          productName: '草莓蛋糕',
          skuName: '6寸',
          skuAttributes: { size: '6寸', flavor: '草莓' },
          quantity: '3',
          unitPriceCents: '6800',
          lineGoodsTotalCents: '20400',
          lineMembershipDiscountCents: '0',
          linePayableCents: '20400',
          remark: null,
          orderCreatedAt: new Date('2026-07-28T02:02:03.000Z'),
          remainingSaleableStock: '23',
        },
      ],
    });
    const { service } = createService([count, rows]);

    const result = await service.export({
      view: AdminOrderExportView.SUPPLY,
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      itemQ: '草莓',
    });
    const workbook = await loadWorkbook(result.buffer);
    const summary = workbook.getWorksheet('SKU 供货汇总');
    const details = workbook.getWorksheet('订单商品明细');

    expect(workbook.worksheets.map(({ name }) => name)).toEqual([
      'SKU 供货汇总',
      '订单商品明细',
    ]);
    expect(summary?.rowCount).toBe(2);
    expect(details?.rowCount).toBe(3);
    expect(summary?.getRow(2).values).toEqual([
      undefined,
      '7',
      '11',
      '草莓蛋糕',
      '6寸',
      'flavor=草莓；size=6寸',
      5,
      2,
      2,
      3,
      23,
      '2026-07-28T01:02:03.000Z',
      AdminOrderSupplyMatchType.SKU_ID,
    ]);
    expect(details?.getCell('M2').value).toBe(68);
    expect(details?.getCell('M2').numFmt).toBe('¥#,##0.00');
    expect(details?.getCell('A2').numFmt).toBe('@');
    expect(details?.getCell('H2').numFmt).toBe('@');
    expect(summary?.views[0]).toEqual(
      expect.objectContaining({ state: 'frozen', ySplit: 1 }),
    );
    expect(summary?.autoFilter).toBe('A1:L1');
    expect(details?.autoFilter).toBe('A1:R1');
    expect(result.rowCount).toBe(2);
    expect(result.filename).toMatch(/^SKU供货清单_\d{8}_\d{6}\.xlsx$/);
  });

  it('aggregates 5,000 same-group details with one internal Set and returns an immutable summary shape', () => {
    const details = Array.from({ length: 5_000 }, (_, index) =>
      createSupplyDetail(index),
    );
    const NativeSet = globalThis.Set;
    let setConstructionCount = 0;
    class CountingSet<T> extends NativeSet<T> {
      constructor(values?: Iterable<T>) {
        super(values);
        setConstructionCount += 1;
      }
    }
    vi.stubGlobal('Set', CountingSet);

    try {
      const result = aggregateSupplyDetails(details);

      expect(result).toEqual([
        expect.objectContaining({
          groupKey: 'sku:11',
          requiredQuantity: 5_000,
          orderCount: 5_000,
          newQuantity: 2_500,
          processingQuantity: 2_500,
        }),
      ]);
      expect(result[0]).not.toHaveProperty('orderIds');
      expect(setConstructionCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    {
      view: AdminOrderExportView.ORDER,
      query: { view: AdminOrderExportView.ORDER } as const,
    },
    {
      view: AdminOrderExportView.SUPPLY,
      query: {
        view: AdminOrderExportView.SUPPLY,
        supplyStatuses: [OrderStatus.NEW],
      } as const,
    },
  ])(
    'serializes the $view workbook only after the transaction callback completes',
    async ({ query }) => {
      const events: string[] = [];
      const writeBuffer = vi
        .spyOn(xlsxPrototype, 'writeBuffer')
        .mockImplementation(async () => {
          events.push('writeBuffer');
          return Buffer.from('xlsx');
        });
      const { service } = createService(
        [
          chainableQueryBuilder({ count: 0 }),
          chainableQueryBuilder({ rows: [] }),
        ],
        {
          onTransactionCallbackComplete: () => {
            events.push('transactionCallbackComplete');
          },
        },
      );

      await service.export(query);

      expect(events).toEqual(['transactionCallbackComplete', 'writeBuffer']);
      expect(writeBuffer).toHaveBeenCalledOnce();
    },
  );

  it('keeps the export latch until workbook serialization completes', async () => {
    let releaseWriteBuffer!: () => void;
    let transactionCallbackCompleted = false;
    vi.spyOn(xlsxPrototype, 'writeBuffer').mockImplementationOnce(
      () =>
        new Promise<Buffer>((resolve) => {
          releaseWriteBuffer = () => resolve(Buffer.from('xlsx'));
        }),
    );
    const { service, transaction } = createService(
      [
        chainableQueryBuilder({ count: 0 }),
        chainableQueryBuilder({ rows: [] }),
      ],
      {
        onTransactionCallbackComplete: () => {
          transactionCallbackCompleted = true;
        },
      },
    );

    const first = service.export({ view: AdminOrderExportView.ORDER });
    try {
      await vi.waitFor(() => {
        expect(transactionCallbackCompleted).toBe(true);
        expect(xlsxPrototype.writeBuffer).toHaveBeenCalledOnce();
      });

      await expect(
        service.export({ view: AdminOrderExportView.ORDER }),
      ).rejects.toMatchObject({
        response: {
          code: ApiErrorCode.EXPORT_IN_PROGRESS,
          message: '订单导出正在生成中，请稍后重试',
          details: { retry: true },
        },
        status: 429,
      });
      expect(transaction).toHaveBeenCalledOnce();
    } finally {
      releaseWriteBuffer();
    }

    await expect(first).resolves.toMatchObject({ rowCount: 0 });
  });

  it('releases the export latch after workbook serialization rejects', async () => {
    const serializationError = new Error('serialization failed');
    vi.spyOn(xlsxPrototype, 'writeBuffer')
      .mockRejectedValueOnce(serializationError)
      .mockResolvedValueOnce(Buffer.from('xlsx'));
    const { service, transaction } = createService([
      chainableQueryBuilder({ count: 0 }),
      chainableQueryBuilder({ rows: [] }),
      chainableQueryBuilder({ count: 0 }),
      chainableQueryBuilder({ rows: [] }),
    ]);

    await expect(
      service.export({ view: AdminOrderExportView.ORDER }),
    ).rejects.toBe(serializationError);
    await expect(
      service.export({ view: AdminOrderExportView.ORDER }),
    ).resolves.toMatchObject({ rowCount: 0 });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('reuses an ExcelJS Buffer without copying it', async () => {
    const contents = Buffer.from('xlsx');
    vi.spyOn(xlsxPrototype, 'writeBuffer').mockResolvedValueOnce(contents);
    const { service } = createService([
      chainableQueryBuilder({ count: 0 }),
      chainableQueryBuilder({ rows: [] }),
    ]);

    const result = await service.export({ view: AdminOrderExportView.ORDER });

    expect(result.buffer).toBe(contents);
  });

  it('allows an ORDER export with exactly 50,000 matching rows and executes the data query', async () => {
    const count = chainableQueryBuilder({ count: 50_000 });
    const rows = chainableQueryBuilder({ rows: [] });
    const { service } = createService([count, rows]);

    await expect(
      service.export({ view: AdminOrderExportView.ORDER }),
    ).resolves.toMatchObject({ rowCount: 50_000 });
    expect(rows.getRawMany).toHaveBeenCalledOnce();
  });

  it('allows a SUPPLY export with exactly 50,000 matching rows and executes the data query', async () => {
    const count = chainableQueryBuilder({ count: 50_000 });
    const rows = chainableQueryBuilder({ rows: [] });
    const { service } = createService([count, rows]);

    await expect(
      service.export({
        view: AdminOrderExportView.SUPPLY,
        supplyStatuses: [OrderStatus.NEW],
      }),
    ).resolves.toMatchObject({ rowCount: 50_000 });
    expect(rows.getRawMany).toHaveBeenCalledOnce();
  });

  it.each([
    {
      query: { view: AdminOrderExportView.ORDER } as const,
      builders: [chainableQueryBuilder({ count: 50_001 })],
    },
    {
      query: {
        view: AdminOrderExportView.SUPPLY,
        supplyStatuses: [OrderStatus.NEW],
      } as const,
      builders: [chainableQueryBuilder({ count: 50_001 })],
    },
  ])(
    'rejects $query.view exports over 50,000 rows without querying data',
    async ({ query, builders }) => {
      const count = builders[0];
      const { service, repository } = createService(builders);

      await expect(service.export(query)).rejects.toMatchObject({
        response: {
          code: ApiErrorCode.EXPORT_TOO_LARGE,
          message: '导出数据超过 50,000 行，请缩小时间范围或筛选条件后重试',
          details: { limit: 50_000, rowCount: 50_001 },
        },
        status: 422,
      });
      expect(count.getCount).toHaveBeenCalledOnce();
      expect(repository.createQueryBuilder).toHaveBeenCalledOnce();
    },
  );

  it('escapes formula prefixes after enforcing the Excel text length limit', () => {
    expect(safeExcelText(`=${'a'.repeat(40_000)}`)).toHaveLength(32_767);
    expect(safeExcelText(`=${'a'.repeat(40_000)}`)).toMatch(/^'/);
    expect(safeExcelText('plain')).toBe('plain');
    expect(safeExcelText(null)).toBe('');
  });
});
