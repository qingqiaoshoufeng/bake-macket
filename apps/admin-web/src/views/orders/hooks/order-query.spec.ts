import {
  AdminOrderExportView,
  BooleanFilter,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';
import { describe, expect, it } from 'vitest';

import type { OrderFilterForm } from '../type/index.js';
import {
  toOrderExportQuery,
  toOrderFilterQuery,
  toOrderQuery,
  toSupplyExportQuery,
  toSupplyQuery,
} from './order-query.js';

const filters: OrderFilterForm = {
  orderNo: ' BM2026 ',
  contact: ' 张三 138 ',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  userId: ' user-1 ',
  itemQ: ' 草莓 6寸 ',
  usesMembership: BooleanFilter.YES,
  usesCredit: BooleanFilter.NO,
  hasRemark: BooleanFilter.YES,
  minPayableYuan: '12.30',
  maxPayableYuan: '100',
  createdAtRange: [
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-08-01T00:00:00.000Z'),
  ],
};

describe('order query converters', () => {
  it('converts trimmed non-status filters, exact cents, and a half-open date range', () => {
    expect(toOrderFilterQuery(filters)).toEqual({
      orderNo: 'BM2026',
      contact: '张三 138',
      fulfillmentType: FulfillmentType.PICKUP,
      userId: 'user-1',
      itemQ: '草莓 6寸',
      usesMembership: BooleanFilter.YES,
      usesCredit: BooleanFilter.NO,
      hasRemark: BooleanFilter.YES,
      minPayableCents: 1230,
      maxPayableCents: 10000,
      createdAtFrom: '2026-07-01T00:00:00.000Z',
      createdAtBefore: '2026-08-01T00:00:00.000Z',
    });
  });

  it('adds the single order status and pagination only to an order list query', () => {
    expect(toOrderQuery(filters, 2, 50)).toEqual(
      expect.objectContaining({
        status: OrderStatus.NEW,
        page: 2,
        pageSize: 50,
      }),
    );
  });

  it('uses explicit supply statuses instead of the order form status', () => {
    expect(
      toSupplyQuery(filters, [OrderStatus.NEW, OrderStatus.PROCESSING], 3, 100),
    ).toEqual(
      expect.objectContaining({
        supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
        page: 3,
        pageSize: 100,
      }),
    );
    expect(
      toSupplyQuery(filters, [OrderStatus.PROCESSING], 1, 20),
    ).not.toHaveProperty('status');
  });

  it('builds discriminated export queries without pagination', () => {
    const orderQuery = toOrderExportQuery(filters);
    const supplyQuery = toSupplyExportQuery(filters, [OrderStatus.NEW]);

    expect(orderQuery).toEqual(
      expect.objectContaining({
        view: AdminOrderExportView.ORDER,
        status: OrderStatus.NEW,
      }),
    );
    expect(orderQuery).not.toHaveProperty('page');
    expect(orderQuery).not.toHaveProperty('pageSize');
    expect(orderQuery).not.toHaveProperty('supplyStatuses');

    expect(supplyQuery).toEqual(
      expect.objectContaining({
        view: AdminOrderExportView.SUPPLY,
        supplyStatuses: [OrderStatus.NEW],
      }),
    );
    expect(supplyQuery).not.toHaveProperty('page');
    expect(supplyQuery).not.toHaveProperty('pageSize');
    expect(supplyQuery).not.toHaveProperty('status');
  });
});
