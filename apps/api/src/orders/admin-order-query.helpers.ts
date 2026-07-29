import {
  BooleanFilter,
  type AdminOrderFilterQuery,
} from '@bake-mall/contracts';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { escapeLike } from '../common/query/admin-query.helpers.js';
import type { Order } from '../database/entities/order.entity.js';

export const SUPPLY_GROUP_KEY_SQL = `CASE
  WHEN item.sku_id IS NOT NULL THEN CONCAT('sku:', item.sku_id)
  ELSE CONCAT(
    'legacy:',
    SHA2(CONCAT_WS(CHAR(0), item.product_name, item.sku_name,
      CAST(item.sku_attributes AS CHAR)), 256)
  )
END`;

type OrderFilterColumns = {
  orderNo: string;
  contactName: string;
  contactPhone: string;
  fulfillmentType: string;
  userId: string;
  membershipId: string;
  creditAppliedCents: string;
  remark: string;
  payableTotalCents: string;
  createdAt: string;
};

type FilterBuilder<T extends ObjectLiteral> = SelectQueryBuilder<T>;

const entityColumns = (order: string): OrderFilterColumns => ({
  orderNo: `${order}.orderNo`,
  contactName: `${order}.contactName`,
  contactPhone: `${order}.contactPhone`,
  fulfillmentType: `${order}.fulfillmentType`,
  userId: `${order}.userId`,
  membershipId: `${order}.membershipId`,
  creditAppliedCents: `${order}.creditAppliedCents`,
  remark: `${order}.remark`,
  payableTotalCents: `${order}.payableTotalCents`,
  createdAt: `${order}.createdAt`,
});

const databaseColumns = (order: string): OrderFilterColumns => ({
  orderNo: `${order}.order_no`,
  contactName: `${order}.contact_name`,
  contactPhone: `${order}.contact_phone`,
  fulfillmentType: `${order}.fulfillment_type`,
  userId: `${order}.user_id`,
  membershipId: `${order}.membership_id`,
  creditAppliedCents: `${order}.credit_applied_cents`,
  remark: `${order}.remark`,
  payableTotalCents: `${order}.payable_total_cents`,
  createdAt: `${order}.created_at`,
});

const likePattern = (value: string): string => `%${escapeLike(value.trim())}%`;

function applySharedHeaderFilters<T extends ObjectLiteral>(
  builder: FilterBuilder<T>,
  query: AdminOrderFilterQuery,
  columns: OrderFilterColumns,
): FilterBuilder<T> {
  if (query.orderNo?.trim()) {
    builder.andWhere(`${columns.orderNo} LIKE :orderNo ESCAPE '\\\\'`, {
      orderNo: likePattern(query.orderNo),
    });
  }
  if (query.contact?.trim()) {
    builder.andWhere(
      `(${columns.contactName} LIKE :contact ESCAPE '\\\\' OR ${columns.contactPhone} LIKE :contact ESCAPE '\\\\')`,
      { contact: likePattern(query.contact) },
    );
  }
  if (query.fulfillmentType) {
    builder.andWhere(`${columns.fulfillmentType} = :fulfillmentType`, {
      fulfillmentType: query.fulfillmentType,
    });
  }
  if (query.userId?.trim()) {
    builder.andWhere(`${columns.userId} = :userId`, {
      userId: query.userId.trim(),
    });
  }
  if (query.usesMembership) {
    builder.andWhere(
      query.usesMembership === BooleanFilter.YES
        ? `${columns.membershipId} IS NOT NULL`
        : `${columns.membershipId} IS NULL`,
    );
  }
  if (query.usesCredit) {
    builder.andWhere(
      query.usesCredit === BooleanFilter.YES
        ? `${columns.creditAppliedCents} > 0`
        : `${columns.creditAppliedCents} = 0`,
    );
  }
  if (query.hasRemark) {
    builder.andWhere(
      query.hasRemark === BooleanFilter.YES
        ? `${columns.remark} IS NOT NULL AND ${columns.remark} <> ''`
        : `(${columns.remark} IS NULL OR ${columns.remark} = '')`,
    );
  }
  if (query.minPayableCents !== undefined) {
    builder.andWhere(`${columns.payableTotalCents} >= :minPayableCents`, {
      minPayableCents: query.minPayableCents,
    });
  }
  if (query.maxPayableCents !== undefined) {
    builder.andWhere(`${columns.payableTotalCents} <= :maxPayableCents`, {
      maxPayableCents: query.maxPayableCents,
    });
  }
  if (query.createdAtFrom) {
    builder.andWhere(`${columns.createdAt} >= :createdAtFrom`, {
      createdAtFrom: new Date(query.createdAtFrom),
    });
  }
  if (query.createdAtBefore) {
    builder.andWhere(`${columns.createdAt} < :createdAtBefore`, {
      createdAtBefore: new Date(query.createdAtBefore),
    });
  }
  return builder;
}

export function applyOrderHeaderFilters(
  builder: SelectQueryBuilder<Order>,
  query: AdminOrderFilterQuery,
): SelectQueryBuilder<Order> {
  applySharedHeaderFilters(builder, query, entityColumns('order'));
  if (query.itemQ?.trim()) {
    builder.andWhere(
      `EXISTS (
        SELECT 1 FROM order_items item
        WHERE item.order_id = order.id
          AND (item.product_name LIKE :itemQ ESCAPE '\\\\'
            OR item.sku_name LIKE :itemQ ESCAPE '\\\\')
      )`,
      { itemQ: likePattern(query.itemQ) },
    );
  }
  return builder;
}

export function applyOrderItemFilters<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  query: AdminOrderFilterQuery,
  aliases: { order: string; item: string },
): SelectQueryBuilder<T> {
  applySharedHeaderFilters(builder, query, databaseColumns(aliases.order));
  if (query.itemQ?.trim()) {
    builder.andWhere(
      `(${aliases.item}.product_name LIKE :itemQ ESCAPE '\\\\' OR ${aliases.item}.sku_name LIKE :itemQ ESCAPE '\\\\')`,
      { itemQ: likePattern(query.itemQ) },
    );
  }
  return builder;
}
