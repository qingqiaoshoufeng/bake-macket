import {
  AdminOrderExportView,
  type AdminOrderExportQuery,
  type AdminOrderFilterQuery,
  type AdminOrderListQuery,
  type AdminOrderSupplyQuery,
  type SupplyOrderStatus,
} from '@bake-mall/contracts';

import { yuanTextToCents } from '../../../utils/money.js';
import type { OrderFilterForm } from '../type/index.js';

const trimmed = (value: string): string | undefined =>
  value.trim() || undefined;

function optionalCents(value: string): number | undefined {
  return value.trim() ? yuanTextToCents(value) : undefined;
}

export function toOrderFilterQuery(
  filters: OrderFilterForm,
): AdminOrderFilterQuery {
  const orderNo = trimmed(filters.orderNo);
  const contact = trimmed(filters.contact);
  const userId = trimmed(filters.userId);
  const itemQ = trimmed(filters.itemQ);
  const minPayableCents = optionalCents(filters.minPayableYuan);
  const maxPayableCents = optionalCents(filters.maxPayableYuan);

  return {
    ...(orderNo ? { orderNo } : {}),
    ...(contact ? { contact } : {}),
    ...(filters.fulfillmentType
      ? { fulfillmentType: filters.fulfillmentType }
      : {}),
    ...(userId ? { userId } : {}),
    ...(itemQ ? { itemQ } : {}),
    ...(filters.usesMembership
      ? { usesMembership: filters.usesMembership }
      : {}),
    ...(filters.usesCredit ? { usesCredit: filters.usesCredit } : {}),
    ...(filters.hasRemark ? { hasRemark: filters.hasRemark } : {}),
    ...(minPayableCents !== undefined ? { minPayableCents } : {}),
    ...(maxPayableCents !== undefined ? { maxPayableCents } : {}),
    ...(filters.createdAtRange
      ? {
          createdAtFrom: filters.createdAtRange[0].toISOString(),
          createdAtBefore: filters.createdAtRange[1].toISOString(),
        }
      : {}),
  };
}

export function toOrderQuery(
  filters: OrderFilterForm,
  page: number,
  pageSize: number,
): AdminOrderListQuery {
  return {
    ...toOrderFilterQuery(filters),
    ...(filters.status ? { status: filters.status } : {}),
    page,
    pageSize,
  };
}

export function toSupplyQuery(
  filters: OrderFilterForm,
  supplyStatuses: readonly SupplyOrderStatus[],
  page: number,
  pageSize: number,
): AdminOrderSupplyQuery {
  return {
    ...toOrderFilterQuery(filters),
    supplyStatuses: [...supplyStatuses],
    page,
    pageSize,
  };
}

export function toOrderExportQuery(
  filters: OrderFilterForm,
): AdminOrderExportQuery {
  return {
    ...toOrderFilterQuery(filters),
    view: AdminOrderExportView.ORDER,
    ...(filters.status ? { status: filters.status } : {}),
  };
}

export function toSupplyExportQuery(
  filters: OrderFilterForm,
  supplyStatuses: readonly SupplyOrderStatus[],
): AdminOrderExportQuery {
  return {
    ...toOrderFilterQuery(filters),
    view: AdminOrderExportView.SUPPLY,
    supplyStatuses: [...supplyStatuses],
  };
}
