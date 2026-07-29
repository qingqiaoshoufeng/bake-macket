import { BooleanFilter } from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  applyOrderHeaderFilters,
  applyOrderItemFilters,
  SUPPLY_GROUP_KEY_SQL,
} from './admin-order-query.helpers.js';

const builderMock = () => {
  const andWhere = vi.fn();
  const builder = { andWhere };
  andWhere.mockReturnValue(builder);
  return builder;
};

describe('admin order query helpers', () => {
  it('applies trimmed and escaped header text filters', () => {
    const builder = builderMock();

    applyOrderHeaderFilters(builder as never, {
      orderNo: ' A%_\\B ',
      contact: ' 138_ ',
      userId: ' 42 ',
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      "order.orderNo LIKE :orderNo ESCAPE '\\\\'",
      { orderNo: '%A\\%\\_\\\\B%' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      "(order.contactName LIKE :contact ESCAPE '\\\\' OR order.contactPhone LIKE :contact ESCAPE '\\\\')",
      { contact: '%138\\_%' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith('order.userId = :userId', {
      userId: '42',
    });
  });

  it('applies boolean, money and half-open created time filters', () => {
    const builder = builderMock();

    applyOrderHeaderFilters(builder as never, {
      usesMembership: BooleanFilter.YES,
      usesCredit: BooleanFilter.NO,
      hasRemark: BooleanFilter.YES,
      minPayableCents: 100,
      maxPayableCents: 500,
      createdAtFrom: '2026-07-01T00:00:00.000Z',
      createdAtBefore: '2026-08-01T00:00:00.000Z',
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      'order.membershipId IS NOT NULL',
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'order.creditAppliedCents = 0',
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      "order.remark IS NOT NULL AND order.remark <> ''",
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'order.payableTotalCents >= :minPayableCents',
      { minPayableCents: 100 },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'order.payableTotalCents <= :maxPayableCents',
      { maxPayableCents: 500 },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'order.createdAt >= :createdAtFrom',
      { createdAtFrom: new Date('2026-07-01T00:00:00.000Z') },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'order.createdAt < :createdAtBefore',
      { createdAtBefore: new Date('2026-08-01T00:00:00.000Z') },
    );
  });

  it('uses an order-level EXISTS for order mode item keywords', () => {
    const builder = builderMock();

    applyOrderHeaderFilters(builder as never, { itemQ: ' 蛋%糕 ' });

    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('EXISTS ('),
      { itemQ: '%蛋\\%糕%' },
    );
    expect(String(builder.andWhere.mock.calls.at(-1)?.[0])).toContain(
      'item.order_id = order.id',
    );
  });

  it('filters only the current item in supply mode', () => {
    const builder = builderMock();

    applyOrderItemFilters(
      builder as never,
      { itemQ: '6_寸', contact: '张' },
      { order: 'supplyOrder', item: 'supplyItem' },
    );

    expect(builder.andWhere).toHaveBeenCalledWith(
      "(supplyItem.product_name LIKE :itemQ ESCAPE '\\\\' OR supplyItem.sku_name LIKE :itemQ ESCAPE '\\\\')",
      { itemQ: '%6\\_寸%' },
    );
    expect(
      builder.andWhere.mock.calls.some(([sql]) =>
        String(sql).includes('EXISTS'),
      ),
    ).toBe(false);
    expect(builder.andWhere).toHaveBeenCalledWith(
      "(supplyOrder.contact_name LIKE :contact ESCAPE '\\\\' OR supplyOrder.contact_phone LIKE :contact ESCAPE '\\\\')",
      { contact: '%张%' },
    );
  });

  it('defines stable SKU and legacy fallback grouping SQL', () => {
    expect(SUPPLY_GROUP_KEY_SQL).toContain("CONCAT('sku:', item.sku_id)");
    expect(SUPPLY_GROUP_KEY_SQL).toContain("'legacy:'");
    expect(SUPPLY_GROUP_KEY_SQL).toContain('SHA2');
    expect(SUPPLY_GROUP_KEY_SQL).toContain('CONCAT_WS(CHAR(0)');
  });
});
