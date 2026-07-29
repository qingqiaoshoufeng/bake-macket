import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AdminOrderSupplyMatchType,
  FulfillmentType,
  OrderStatus,
  SUPPLY_ORDER_STATUSES,
  type AdminOrderSupplyDetailItem,
  type AdminOrderSupplyDetailQuery,
  type AdminOrderSupplyDetailResult,
  type AdminOrderSupplyItem,
  type AdminOrderSupplyQuery,
  type AdminOrderSupplyResult,
  type SupplyOrderStatus,
} from '@bake-mall/contracts';
import { type SelectQueryBuilder, Repository } from 'typeorm';

import { OrderItem } from '../database/entities/order-item.entity.js';
import {
  applyOrderItemFilters,
  SUPPLY_GROUP_KEY_SQL,
} from './admin-order-query.helpers.js';

type SupplySummaryRaw = {
  groupKey: unknown;
  productId: unknown;
  skuId: unknown;
  productName: unknown;
  skuName: unknown;
  skuAttributes: unknown;
  requiredQuantity: unknown;
  orderCount: unknown;
  newQuantity: unknown;
  processingQuantity: unknown;
  remainingSaleableStock: unknown;
  earliestOrderCreatedAt: unknown;
};

type SupplyDetailRaw = {
  orderItemId: unknown;
  orderId: unknown;
  orderNo: unknown;
  status: unknown;
  fulfillmentType: unknown;
  contactName: unknown;
  contactPhone: unknown;
  pickupTimeText: unknown;
  deliveryAddressText: unknown;
  productId: unknown;
  skuId: unknown;
  productName: unknown;
  skuName: unknown;
  skuAttributes: unknown;
  quantity: unknown;
  unitPriceCents: unknown;
  lineGoodsTotalCents: unknown;
  lineMembershipDiscountCents: unknown;
  linePayableCents: unknown;
  remark: unknown;
  orderCreatedAt: unknown;
};

type CountRaw = { total: unknown };

const SUPPLY_STATUS_SET = new Set<SupplyOrderStatus>(SUPPLY_ORDER_STATUSES);
const SKU_GROUP_KEY_PATTERN = /^sku:([1-9]\d*)$/;

const REPRESENTATIVE_ITEM_PAYLOAD_SQL = `SUBSTRING_INDEX(MIN(CONCAT(
  DATE_FORMAT(order.created_at, '%Y-%m-%d %H:%i:%s'), CHAR(0),
  LPAD(order.id, 20, '0'), CHAR(0),
  LPAD(item.id, 20, '0'), CHAR(0),
  JSON_ARRAY(item.product_id, item.sku_id, item.product_name, item.sku_name,
    item.sku_attributes)
)), CHAR(0), -1)`;

function representativeItemFieldSql(
  jsonIndex: number,
  options: { nullable?: boolean; unquote?: boolean } = {},
): string {
  const extracted = `JSON_EXTRACT(${REPRESENTATIVE_ITEM_PAYLOAD_SQL}, '$[${jsonIndex}]')`;
  const value = options.unquote ? `JSON_UNQUOTE(${extracted})` : extracted;
  return options.nullable ? `NULLIF(${value}, 'null')` : value;
}

export function computeSafeOffset(page: number, pageSize: number): number {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1
  ) {
    throw new BadRequestException(
      'page and pageSize must be positive safe integers',
    );
  }
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new BadRequestException(
      'page and pageSize must produce a safe offset',
    );
  }
  return offset;
}

function assertSupplyStatuses(
  statuses: readonly SupplyOrderStatus[],
): readonly SupplyOrderStatus[] {
  const valid =
    statuses.length >= 1 &&
    statuses.length <= SUPPLY_ORDER_STATUSES.length &&
    new Set(statuses).size === statuses.length &&
    statuses.every((status) => SUPPLY_STATUS_SET.has(status));
  if (!valid) {
    throw new BadRequestException(
      'supplyStatuses must contain NEW, PROCESSING, or both without duplicates',
    );
  }
  return statuses;
}

function toSafeInteger(value: unknown, field: string): number {
  const integer = (() => {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return BigInt(value);
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return BigInt(value);
    }
    throw new Error(`Invalid MySQL integer for ${field}: ${String(value)}`);
  })();
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `${field} exceeds Number.MAX_SAFE_INTEGER: ${integer.toString()}`,
    );
  }
  return Number(integer);
}

function toRequiredString(value: unknown, field: string): string {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'bigint'
  ) {
    throw new Error(`Invalid MySQL value for ${field}: ${String(value)}`);
  }
  return String(value);
}

function toOptionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function toIsoString(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid MySQL datetime for ${field}: ${String(value)}`);
  }
  return date.toISOString();
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function toSkuAttributes(
  value: unknown,
  field: string,
): Readonly<Record<string, string>> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!isStringRecord(parsed)) {
    throw new Error(`Invalid MySQL JSON object for ${field}`);
  }
  return { ...parsed };
}

function mapSupplySummary(row: SupplySummaryRaw): AdminOrderSupplyItem {
  const groupKey = toRequiredString(row.groupKey, 'groupKey');
  const skuId = toOptionalString(row.skuId);
  const productId = toOptionalString(row.productId);
  const remainingSaleableStock =
    row.remainingSaleableStock === null ||
    row.remainingSaleableStock === undefined
      ? undefined
      : toSafeInteger(row.remainingSaleableStock, 'remainingSaleableStock');
  return {
    groupKey,
    matchType: skuId
      ? AdminOrderSupplyMatchType.SKU_ID
      : AdminOrderSupplyMatchType.LEGACY_FALLBACK,
    ...(productId ? { productId } : {}),
    ...(skuId ? { skuId } : {}),
    productName: toRequiredString(row.productName, 'productName'),
    skuName: toRequiredString(row.skuName, 'skuName'),
    skuAttributes: toSkuAttributes(row.skuAttributes, 'skuAttributes'),
    requiredQuantity: toSafeInteger(row.requiredQuantity, 'requiredQuantity'),
    orderCount: toSafeInteger(row.orderCount, 'orderCount'),
    newQuantity: toSafeInteger(row.newQuantity, 'newQuantity'),
    processingQuantity: toSafeInteger(
      row.processingQuantity,
      'processingQuantity',
    ),
    ...(remainingSaleableStock === undefined ? {} : { remainingSaleableStock }),
    earliestOrderCreatedAt: toIsoString(
      row.earliestOrderCreatedAt,
      'earliestOrderCreatedAt',
    ),
  };
}

function mapSupplyDetail(row: SupplyDetailRaw): AdminOrderSupplyDetailItem {
  const status = toRequiredString(row.status, 'status') as SupplyOrderStatus;
  if (!SUPPLY_STATUS_SET.has(status)) {
    throw new Error(`Unexpected supply order status: ${status}`);
  }
  const fulfillmentType = toRequiredString(
    row.fulfillmentType,
    'fulfillmentType',
  ) as FulfillmentType;
  if (!Object.values(FulfillmentType).includes(fulfillmentType)) {
    throw new Error(`Unexpected fulfillment type: ${fulfillmentType}`);
  }
  const productId = toOptionalString(row.productId);
  const skuId = toOptionalString(row.skuId);
  const pickupTimeText = toOptionalString(row.pickupTimeText);
  const deliveryAddressText = toOptionalString(row.deliveryAddressText);
  const remark = toOptionalString(row.remark);
  return {
    orderItemId: toRequiredString(row.orderItemId, 'orderItemId'),
    orderId: toRequiredString(row.orderId, 'orderId'),
    orderNo: toRequiredString(row.orderNo, 'orderNo'),
    status,
    fulfillmentType,
    contactName: toRequiredString(row.contactName, 'contactName'),
    contactPhone: toRequiredString(row.contactPhone, 'contactPhone'),
    ...(pickupTimeText ? { pickupTimeText } : {}),
    ...(deliveryAddressText ? { deliveryAddressText } : {}),
    ...(productId ? { productId } : {}),
    ...(skuId ? { skuId } : {}),
    productName: toRequiredString(row.productName, 'productName'),
    skuName: toRequiredString(row.skuName, 'skuName'),
    skuAttributes: toSkuAttributes(row.skuAttributes, 'skuAttributes'),
    quantity: toSafeInteger(row.quantity, 'quantity'),
    unitPriceCents: toSafeInteger(row.unitPriceCents, 'unitPriceCents'),
    lineGoodsTotalCents: toSafeInteger(
      row.lineGoodsTotalCents,
      'lineGoodsTotalCents',
    ),
    lineMembershipDiscountCents: toSafeInteger(
      row.lineMembershipDiscountCents,
      'lineMembershipDiscountCents',
    ),
    linePayableCents: toSafeInteger(row.linePayableCents, 'linePayableCents'),
    ...(remark ? { remark } : {}),
    orderCreatedAt: toIsoString(row.orderCreatedAt, 'orderCreatedAt'),
  };
}

function applySupplyScope<T extends AdminOrderSupplyQuery>(
  builder: SelectQueryBuilder<OrderItem>,
  query: T,
  statuses: readonly SupplyOrderStatus[],
): SelectQueryBuilder<OrderItem> {
  builder.where('order.status IN (:...supplyStatuses)', {
    supplyStatuses: statuses,
  });
  return applyOrderItemFilters(builder, query, {
    order: 'order',
    item: 'item',
  });
}

function createSupplyBaseQuery(
  repository: Repository<OrderItem>,
): SelectQueryBuilder<OrderItem> {
  return repository
    .createQueryBuilder('item')
    .innerJoin('orders', 'order', 'order.id = item.order_id');
}

@Injectable()
export class AdminOrderQueryService {
  constructor(
    @InjectRepository(OrderItem)
    private readonly orderItems: Repository<OrderItem>,
  ) {}

  async listSupply(
    query: AdminOrderSupplyQuery,
  ): Promise<AdminOrderSupplyResult> {
    const offset = computeSafeOffset(query.page, query.pageSize);
    const statuses = assertSupplyStatuses(query.supplyStatuses);
    const rowsQuery = applySupplyScope(
      createSupplyBaseQuery(this.orderItems).leftJoin(
        'skus',
        'sku',
        'sku.id = item.sku_id',
      ),
      query,
      statuses,
    )
      .select(SUPPLY_GROUP_KEY_SQL, 'groupKey')
      .addSelect(
        representativeItemFieldSql(0, { nullable: true, unquote: true }),
        'productId',
      )
      .addSelect(
        representativeItemFieldSql(1, { nullable: true, unquote: true }),
        'skuId',
      )
      .addSelect(
        representativeItemFieldSql(2, { unquote: true }),
        'productName',
      )
      .addSelect(representativeItemFieldSql(3, { unquote: true }), 'skuName')
      .addSelect(representativeItemFieldSql(4), 'skuAttributes')
      .addSelect('SUM(item.quantity)', 'requiredQuantity')
      .addSelect('COUNT(DISTINCT order.id)', 'orderCount')
      .addSelect(
        `SUM(CASE WHEN order.status = '${OrderStatus.NEW}' THEN item.quantity ELSE 0 END)`,
        'newQuantity',
      )
      .addSelect(
        `SUM(CASE WHEN order.status = '${OrderStatus.PROCESSING}' THEN item.quantity ELSE 0 END)`,
        'processingQuantity',
      )
      .addSelect('MAX(sku.stock)', 'remainingSaleableStock')
      .addSelect('MIN(order.created_at)', 'earliestOrderCreatedAt')
      .groupBy(SUPPLY_GROUP_KEY_SQL)
      .orderBy('requiredQuantity', 'DESC')
      .addOrderBy('earliestOrderCreatedAt', 'ASC')
      .addOrderBy('groupKey', 'ASC')
      .offset(offset)
      .limit(query.pageSize);
    const countQuery = applySupplyScope(
      createSupplyBaseQuery(this.orderItems),
      query,
      statuses,
    ).select(`COUNT(DISTINCT ${SUPPLY_GROUP_KEY_SQL})`, 'total');

    const [rows, count] = await Promise.all([
      rowsQuery.getRawMany<SupplySummaryRaw>(),
      countQuery.getRawOne<CountRaw>(),
    ]);
    return {
      items: rows.map(mapSupplySummary),
      page: query.page,
      pageSize: query.pageSize,
      total: toSafeInteger(count?.total ?? 0, 'total'),
    };
  }

  async listSupplyItems(
    query: AdminOrderSupplyDetailQuery,
  ): Promise<AdminOrderSupplyDetailResult> {
    const offset = computeSafeOffset(query.page, query.pageSize);
    const statuses = assertSupplyStatuses(query.supplyStatuses);
    const groupSkuId = SKU_GROUP_KEY_PATTERN.exec(query.groupKey)?.[1];
    const createScopedQuery = (): SelectQueryBuilder<OrderItem> => {
      const builder = applySupplyScope(
        createSupplyBaseQuery(this.orderItems),
        query,
        statuses,
      ).andWhere(`(${SUPPLY_GROUP_KEY_SQL}) = :groupKey`, {
        groupKey: query.groupKey,
      });
      return groupSkuId
        ? builder.andWhere('item.sku_id = :groupSkuId', { groupSkuId })
        : builder;
    };
    const rowsQuery = createScopedQuery()
      .select('item.id', 'orderItemId')
      .addSelect('order.id', 'orderId')
      .addSelect('order.order_no', 'orderNo')
      .addSelect('order.status', 'status')
      .addSelect('order.fulfillment_type', 'fulfillmentType')
      .addSelect('order.contact_name', 'contactName')
      .addSelect('order.contact_phone', 'contactPhone')
      .addSelect('order.pickup_time_text', 'pickupTimeText')
      .addSelect('order.delivery_address_text', 'deliveryAddressText')
      .addSelect('item.product_id', 'productId')
      .addSelect('item.sku_id', 'skuId')
      .addSelect('item.product_name', 'productName')
      .addSelect('item.sku_name', 'skuName')
      .addSelect('item.sku_attributes', 'skuAttributes')
      .addSelect('item.quantity', 'quantity')
      .addSelect('item.unit_price_cents', 'unitPriceCents')
      .addSelect('item.line_goods_total_cents', 'lineGoodsTotalCents')
      .addSelect(
        'item.line_membership_discount_cents',
        'lineMembershipDiscountCents',
      )
      .addSelect('item.line_payable_cents', 'linePayableCents')
      .addSelect('order.remark', 'remark')
      .addSelect('order.created_at', 'orderCreatedAt')
      .orderBy('order.created_at', 'ASC')
      .addOrderBy('order.id', 'ASC')
      .addOrderBy('item.id', 'ASC')
      .offset(offset)
      .limit(query.pageSize);
    const countQuery = createScopedQuery().select('COUNT(item.id)', 'total');

    const [rows, count] = await Promise.all([
      rowsQuery.getRawMany<SupplyDetailRaw>(),
      countQuery.getRawOne<CountRaw>(),
    ]);
    return {
      items: rows.map(mapSupplyDetail),
      page: query.page,
      pageSize: query.pageSize,
      total: toSafeInteger(count?.total ?? 0, 'total'),
    };
  }
}
