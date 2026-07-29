import {
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  AdminOrderExportView,
  AdminOrderSupplyMatchType,
  ApiErrorCode,
  OrderStatus,
  SUPPLY_ORDER_STATUSES,
  type AdminOrderExportQuery,
  type AdminOrderSupplyItem,
  type SupplyOrderStatus,
} from '@bake-mall/contracts';
import { Workbook, type Column, type Worksheet } from 'exceljs';
import {
  DataSource,
  type EntityManager,
  type Repository,
  type SelectQueryBuilder,
} from 'typeorm';

import { Order } from '../database/entities/order.entity.js';
import { OrderItem } from '../database/entities/order-item.entity.js';
import {
  applyOrderHeaderFilters,
  applyOrderItemFilters,
  SUPPLY_GROUP_KEY_SQL,
} from './admin-order-query.helpers.js';

const MAX_EXPORT_ROWS = 50_000;
const MAX_EXCEL_TEXT_LENGTH = 32_767;
const EXCEL_FORMULA_PREFIX = /^[=+\-@]/;
const MONEY_FORMAT = '¥#,##0.00';
const TEXT_FORMAT = '@';

const ORDER_SHEET_NAME = '订单列表';
const SUPPLY_SUMMARY_SHEET_NAME = 'SKU 供货汇总';
const SUPPLY_DETAIL_SHEET_NAME = '订单商品明细';

export type AdminOrderExportFile = {
  buffer: Buffer;
  filename: string;
  rowCount: number;
};

type OrderExportRaw = {
  orderNo: unknown;
  userId: unknown;
  contactName: unknown;
  contactPhone: unknown;
  status: unknown;
  fulfillmentType: unknown;
  itemLineCount: unknown;
  totalQuantity: unknown;
  goodsTotalCents: unknown;
  membershipDiscountCents: unknown;
  creditAppliedCents: unknown;
  payableTotalCents: unknown;
  pickupTimeText: unknown;
  deliveryAddressText: unknown;
  membershipCode: unknown;
  membershipName: unknown;
  membershipDiscountBasisPoints: unknown;
  remark: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

type SupplyExportRaw = {
  groupKey: unknown;
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
  remainingSaleableStock: unknown;
};

type SupplyExportDetail = {
  groupKey: string;
  orderItemId: string;
  orderId: string;
  orderNo: string;
  status: SupplyOrderStatus;
  fulfillmentType: string;
  contactName: string;
  contactPhone: string;
  pickupTimeText?: string;
  deliveryAddressText?: string;
  productId?: string;
  skuId?: string;
  productName: string;
  skuName: string;
  skuAttributes: Readonly<Record<string, string>>;
  quantity: number;
  unitPriceCents: number;
  lineGoodsTotalCents: number;
  lineMembershipDiscountCents: number;
  linePayableCents: number;
  remark?: string;
  orderCreatedAt: string;
  remainingSaleableStock?: number;
};

type SupplyExportAccumulator = Omit<AdminOrderSupplyItem, 'orderCount'> & {
  orderIds: Set<string>;
};

type OrderExportRow = {
  orderNo: string;
  userId: string;
  contactName: string;
  contactPhone: string;
  status: string;
  fulfillmentType: string;
  itemLineCount: number;
  totalQuantity: number;
  goodsTotal: number;
  membershipDiscount: number;
  creditApplied: number;
  payableTotal: number;
  fulfillmentSnapshot: string;
  membershipCode: string;
  membershipName: string;
  membershipDiscountSnapshot: string;
  remark: string;
  createdAt: string;
  updatedAt: string;
};

type OrderExportSnapshot = {
  view: AdminOrderExportView.ORDER;
  rows: OrderExportRow[];
  rowCount: number;
};

type SupplyExportSnapshot = {
  view: AdminOrderExportView.SUPPLY;
  rows: readonly SupplyExportDetail[];
  rowCount: number;
};

type AdminOrderExportSnapshot = OrderExportSnapshot | SupplyExportSnapshot;

type ExportColumn = Partial<Column> & {
  header: string;
  key: string;
  width: number;
};

export function safeExcelText(value: string | null | undefined): string {
  const text = value ?? '';
  const escaped = EXCEL_FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return escaped.slice(0, MAX_EXCEL_TEXT_LENGTH);
}

export const centsToExcelYuan = (cents: number): number => cents / 100;

const toRequiredString = (value: unknown, field: string): string => {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'bigint'
  ) {
    throw new Error(`Invalid database value for ${field}: ${String(value)}`);
  }
  return String(value);
};

const toOptionalString = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : String(value);

const toSafeInteger = (value: unknown, field: string): number => {
  const integer = (() => {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return BigInt(value);
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return BigInt(value);
    }
    throw new Error(`Invalid database integer for ${field}: ${String(value)}`);
  })();
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `${field} exceeds Number.MAX_SAFE_INTEGER: ${integer.toString()}`,
    );
  }
  return Number(integer);
};

const toIsoString = (value: unknown, field: string): string => {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid database datetime for ${field}: ${String(value)}`);
  }
  return date.toISOString();
};

const toSkuAttributes = (value: unknown): Readonly<Record<string, string>> => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((entry) => typeof entry === 'string')
  ) {
    throw new Error('Invalid database JSON object for skuAttributes');
  }
  return { ...(parsed as Record<string, string>) };
};

const formatSkuAttributes = (
  attributes: Readonly<Record<string, string>>,
): string =>
  Object.entries(attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('；');

const formatTimestamp = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
};

const createFilename = (view: AdminOrderExportView, now = new Date()): string =>
  `${view === AdminOrderExportView.ORDER ? '订单列表' : 'SKU供货清单'}_${formatTimestamp(now)}.xlsx`;

const configureWorksheet = (
  worksheet: Worksheet,
  columns: readonly ExportColumn[],
  options: { moneyKeys?: readonly string[]; textKeys?: readonly string[] } = {},
): void => {
  worksheet.columns = columns as ExportColumn[];
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: 'A1',
    to: `${worksheet.getColumn(columns.length).letter}1`,
  };
  worksheet.getRow(1).font = { bold: true };
  for (const key of options.moneyKeys ?? []) {
    worksheet.getColumn(key).numFmt = MONEY_FORMAT;
  }
  for (const key of options.textKeys ?? []) {
    worksheet.getColumn(key).numFmt = TEXT_FORMAT;
  }
};

const assertWithinExportLimit = (rowCount: number): void => {
  if (rowCount <= MAX_EXPORT_ROWS) return;
  throw new UnprocessableEntityException({
    code: ApiErrorCode.EXPORT_TOO_LARGE,
    message: '导出数据超过 50,000 行，请缩小时间范围或筛选条件后重试',
    details: { limit: MAX_EXPORT_ROWS, rowCount },
  });
};

const createSupplyBaseQuery = (
  repository: Repository<OrderItem>,
): SelectQueryBuilder<OrderItem> =>
  repository
    .createQueryBuilder('item')
    .innerJoin('orders', 'order', 'order.id = item.order_id');

const applySupplyScope = (
  builder: SelectQueryBuilder<OrderItem>,
  query: Extract<AdminOrderExportQuery, { view: AdminOrderExportView.SUPPLY }>,
): SelectQueryBuilder<OrderItem> => {
  builder.where('order.status IN (:...supplyStatuses)', {
    supplyStatuses: query.supplyStatuses,
  });
  return applyOrderItemFilters(builder, query, {
    order: 'order',
    item: 'item',
  });
};

const mapOrderRow = (row: OrderExportRaw): OrderExportRow => ({
  orderNo: safeExcelText(toRequiredString(row.orderNo, 'orderNo')),
  userId: safeExcelText(toRequiredString(row.userId, 'userId')),
  contactName: safeExcelText(toRequiredString(row.contactName, 'contactName')),
  contactPhone: safeExcelText(
    toRequiredString(row.contactPhone, 'contactPhone'),
  ),
  status: safeExcelText(toRequiredString(row.status, 'status')),
  fulfillmentType: safeExcelText(
    toRequiredString(row.fulfillmentType, 'fulfillmentType'),
  ),
  itemLineCount: toSafeInteger(row.itemLineCount, 'itemLineCount'),
  totalQuantity: toSafeInteger(row.totalQuantity, 'totalQuantity'),
  goodsTotal: centsToExcelYuan(
    toSafeInteger(row.goodsTotalCents, 'goodsTotalCents'),
  ),
  membershipDiscount: centsToExcelYuan(
    toSafeInteger(row.membershipDiscountCents, 'membershipDiscountCents'),
  ),
  creditApplied: centsToExcelYuan(
    toSafeInteger(row.creditAppliedCents, 'creditAppliedCents'),
  ),
  payableTotal: centsToExcelYuan(
    toSafeInteger(row.payableTotalCents, 'payableTotalCents'),
  ),
  fulfillmentSnapshot: safeExcelText(
    toOptionalString(row.pickupTimeText) ??
      toOptionalString(row.deliveryAddressText),
  ),
  membershipCode: safeExcelText(toOptionalString(row.membershipCode)),
  membershipName: safeExcelText(toOptionalString(row.membershipName)),
  membershipDiscountSnapshot:
    row.membershipDiscountBasisPoints === null ||
    row.membershipDiscountBasisPoints === undefined
      ? ''
      : `${
          toSafeInteger(
            row.membershipDiscountBasisPoints,
            'membershipDiscountBasisPoints',
          ) / 100
        }%`,
  remark: safeExcelText(toOptionalString(row.remark)),
  createdAt: toIsoString(row.createdAt, 'createdAt'),
  updatedAt: toIsoString(row.updatedAt, 'updatedAt'),
});

const mapSupplyDetail = (row: SupplyExportRaw): SupplyExportDetail => {
  const status = toRequiredString(row.status, 'status') as SupplyOrderStatus;
  if (!SUPPLY_ORDER_STATUSES.includes(status)) {
    throw new Error(`Unexpected supply order status: ${status}`);
  }
  const productId = toOptionalString(row.productId);
  const skuId = toOptionalString(row.skuId);
  const pickupTimeText = toOptionalString(row.pickupTimeText);
  const deliveryAddressText = toOptionalString(row.deliveryAddressText);
  const remark = toOptionalString(row.remark);
  const remainingSaleableStock =
    row.remainingSaleableStock === null ||
    row.remainingSaleableStock === undefined
      ? undefined
      : toSafeInteger(row.remainingSaleableStock, 'remainingSaleableStock');
  return {
    groupKey: toRequiredString(row.groupKey, 'groupKey'),
    orderItemId: toRequiredString(row.orderItemId, 'orderItemId'),
    orderId: toRequiredString(row.orderId, 'orderId'),
    orderNo: toRequiredString(row.orderNo, 'orderNo'),
    status,
    fulfillmentType: toRequiredString(row.fulfillmentType, 'fulfillmentType'),
    contactName: toRequiredString(row.contactName, 'contactName'),
    contactPhone: toRequiredString(row.contactPhone, 'contactPhone'),
    ...(pickupTimeText ? { pickupTimeText } : {}),
    ...(deliveryAddressText ? { deliveryAddressText } : {}),
    ...(productId ? { productId } : {}),
    ...(skuId ? { skuId } : {}),
    productName: toRequiredString(row.productName, 'productName'),
    skuName: toRequiredString(row.skuName, 'skuName'),
    skuAttributes: toSkuAttributes(row.skuAttributes),
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
    ...(remainingSaleableStock === undefined ? {} : { remainingSaleableStock }),
  };
};

export function aggregateSupplyDetails(
  details: readonly SupplyExportDetail[],
): readonly AdminOrderSupplyItem[] {
  // 性能敏感的局部聚合器有意原地更新 Map/Set 和计数；最终映射为全新领域对象，
  // 不会向调用方泄漏任何可变集合。明细已稳定排序，因此仅首次记录代表快照。
  const accumulators = new Map<string, SupplyExportAccumulator>();
  for (const detail of details) {
    const accumulator =
      accumulators.get(detail.groupKey) ??
      (() => {
        const created: SupplyExportAccumulator = {
          groupKey: detail.groupKey,
          matchType: detail.skuId
            ? AdminOrderSupplyMatchType.SKU_ID
            : AdminOrderSupplyMatchType.LEGACY_FALLBACK,
          ...(detail.productId ? { productId: detail.productId } : {}),
          ...(detail.skuId ? { skuId: detail.skuId } : {}),
          productName: detail.productName,
          skuName: detail.skuName,
          skuAttributes: detail.skuAttributes,
          requiredQuantity: 0,
          orderIds: new Set<string>(),
          newQuantity: 0,
          processingQuantity: 0,
          ...(detail.remainingSaleableStock === undefined
            ? {}
            : { remainingSaleableStock: detail.remainingSaleableStock }),
          earliestOrderCreatedAt: detail.orderCreatedAt,
        };
        accumulators.set(detail.groupKey, created);
        return created;
      })();
    accumulator.orderIds.add(detail.orderId);
    accumulator.requiredQuantity += detail.quantity;
    accumulator.newQuantity +=
      detail.status === OrderStatus.NEW ? detail.quantity : 0;
    accumulator.processingQuantity +=
      detail.status === OrderStatus.PROCESSING ? detail.quantity : 0;
  }
  return [...accumulators.values()]
    .map(({ orderIds, ...summary }): AdminOrderSupplyItem => ({
      ...summary,
      orderCount: orderIds.size,
    }))
    .sort(
      (left, right) =>
        right.requiredQuantity - left.requiredQuantity ||
        left.earliestOrderCreatedAt.localeCompare(
          right.earliestOrderCreatedAt,
        ) ||
        left.groupKey.localeCompare(right.groupKey),
    );
}

@Injectable()
export class AdminOrderExportService {
  private exportInProgress = false;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async export(query: AdminOrderExportQuery): Promise<AdminOrderExportFile> {
    if (this.exportInProgress) {
      throw new HttpException(
        {
          code: ApiErrorCode.EXPORT_IN_PROGRESS,
          message: '订单导出正在生成中，请稍后重试',
          details: { retry: true },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.exportInProgress = true;
    try {
      const snapshot = await this.dataSource.transaction(
        'REPEATABLE READ',
        async (manager): Promise<AdminOrderExportSnapshot> =>
          query.view === AdminOrderExportView.ORDER
            ? this.loadOrderSnapshot(manager, query)
            : this.loadSupplySnapshot(manager, query),
      );
      return await (snapshot.view === AdminOrderExportView.ORDER
        ? this.buildOrderFile(snapshot)
        : this.buildSupplyFile(snapshot));
    } finally {
      this.exportInProgress = false;
    }
  }

  private async loadOrderSnapshot(
    manager: EntityManager,
    query: Extract<AdminOrderExportQuery, { view: AdminOrderExportView.ORDER }>,
  ): Promise<OrderExportSnapshot> {
    const repository = manager.getRepository(Order);
    const createScopedQuery = (): SelectQueryBuilder<Order> => {
      const builder = applyOrderHeaderFilters(
        repository.createQueryBuilder('order'),
        query,
      );
      if (query.status) {
        builder.andWhere('order.status = :status', { status: query.status });
      }
      return builder;
    };
    const rowCount = await createScopedQuery().getCount();
    assertWithinExportLimit(rowCount);
    const rawRows = await createScopedQuery()
      .leftJoin('order_items', 'item', 'item.order_id = order.id')
      .select('order.order_no', 'orderNo')
      .addSelect('order.user_id', 'userId')
      .addSelect('order.contact_name', 'contactName')
      .addSelect('order.contact_phone', 'contactPhone')
      .addSelect('order.status', 'status')
      .addSelect('order.fulfillment_type', 'fulfillmentType')
      .addSelect('COUNT(item.id)', 'itemLineCount')
      .addSelect('COALESCE(SUM(item.quantity), 0)', 'totalQuantity')
      .addSelect('order.goods_total_cents', 'goodsTotalCents')
      .addSelect('order.membership_discount_cents', 'membershipDiscountCents')
      .addSelect('order.credit_applied_cents', 'creditAppliedCents')
      .addSelect('order.payable_total_cents', 'payableTotalCents')
      .addSelect('order.pickup_time_text', 'pickupTimeText')
      .addSelect('order.delivery_address_text', 'deliveryAddressText')
      .addSelect('order.membership_code', 'membershipCode')
      .addSelect('order.membership_name', 'membershipName')
      .addSelect(
        'order.membership_discount_basis_points',
        'membershipDiscountBasisPoints',
      )
      .addSelect('order.remark', 'remark')
      .addSelect('order.created_at', 'createdAt')
      .addSelect('order.updated_at', 'updatedAt')
      .groupBy('order.id')
      .orderBy('order.created_at', 'DESC')
      .addOrderBy('order.id', 'DESC')
      .getRawMany<OrderExportRaw>();
    return { view: query.view, rows: rawRows.map(mapOrderRow), rowCount };
  }

  private buildOrderFile(
    snapshot: OrderExportSnapshot,
  ): Promise<AdminOrderExportFile> {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet(ORDER_SHEET_NAME);
    configureWorksheet(
      worksheet,
      [
        { header: '订单号', key: 'orderNo', width: 24 },
        { header: '用户 ID', key: 'userId', width: 22 },
        { header: '联系人', key: 'contactName', width: 16 },
        { header: '手机号', key: 'contactPhone', width: 18 },
        { header: '状态', key: 'status', width: 14 },
        { header: '履约方式', key: 'fulfillmentType', width: 14 },
        { header: '商品种类数', key: 'itemLineCount', width: 14 },
        { header: '商品总件数', key: 'totalQuantity', width: 14 },
        { header: '商品原价', key: 'goodsTotal', width: 14 },
        { header: '会员优惠', key: 'membershipDiscount', width: 14 },
        { header: '消费金抵扣', key: 'creditApplied', width: 14 },
        { header: '应付金额', key: 'payableTotal', width: 14 },
        {
          header: '自提时间或配送地址快照',
          key: 'fulfillmentSnapshot',
          width: 36,
        },
        { header: '会员 code', key: 'membershipCode', width: 18 },
        { header: '会员名称', key: 'membershipName', width: 18 },
        {
          header: '会员折扣快照',
          key: 'membershipDiscountSnapshot',
          width: 16,
        },
        { header: '买家备注', key: 'remark', width: 28 },
        { header: '下单时间', key: 'createdAt', width: 26 },
        { header: '更新时间', key: 'updatedAt', width: 26 },
      ],
      {
        moneyKeys: [
          'goodsTotal',
          'membershipDiscount',
          'creditApplied',
          'payableTotal',
        ],
        textKeys: ['orderNo', 'userId', 'contactPhone', 'membershipCode'],
      },
    );
    worksheet.addRows(snapshot.rows);
    return this.createResult(workbook, snapshot.view, snapshot.rowCount);
  }

  private async loadSupplySnapshot(
    manager: EntityManager,
    query: Extract<
      AdminOrderExportQuery,
      { view: AdminOrderExportView.SUPPLY }
    >,
  ): Promise<SupplyExportSnapshot> {
    const repository = manager.getRepository(OrderItem);
    const rowCount = await applySupplyScope(
      createSupplyBaseQuery(repository),
      query,
    ).getCount();
    assertWithinExportLimit(rowCount);
    const rawRows = await applySupplyScope(
      createSupplyBaseQuery(repository).leftJoin(
        'skus',
        'sku',
        'sku.id = item.sku_id',
      ),
      query,
    )
      .select(SUPPLY_GROUP_KEY_SQL, 'groupKey')
      .addSelect('item.id', 'orderItemId')
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
      .addSelect('sku.stock', 'remainingSaleableStock')
      .orderBy('order.created_at', 'ASC')
      .addOrderBy('order.id', 'ASC')
      .addOrderBy('item.id', 'ASC')
      .getRawMany<SupplyExportRaw>();
    return { view: query.view, rows: rawRows.map(mapSupplyDetail), rowCount };
  }

  private buildSupplyFile(
    snapshot: SupplyExportSnapshot,
  ): Promise<AdminOrderExportFile> {
    const summaries = aggregateSupplyDetails(snapshot.rows);
    const workbook = new Workbook();
    this.addSupplySummaryWorksheet(workbook, summaries);
    this.addSupplyDetailWorksheet(workbook, snapshot.rows);
    return this.createResult(workbook, snapshot.view, snapshot.rowCount);
  }

  private addSupplySummaryWorksheet(
    workbook: Workbook,
    summaries: readonly AdminOrderSupplyItem[],
  ): void {
    const worksheet = workbook.addWorksheet(SUPPLY_SUMMARY_SHEET_NAME);
    configureWorksheet(
      worksheet,
      [
        { header: '商品 ID', key: 'productId', width: 22 },
        { header: 'SKU ID', key: 'skuId', width: 22 },
        { header: '商品名', key: 'productName', width: 24 },
        { header: 'SKU 名', key: 'skuName', width: 20 },
        { header: '规格', key: 'skuAttributes', width: 28 },
        { header: '需供货数量', key: 'requiredQuantity', width: 14 },
        { header: '涉及订单数', key: 'orderCount', width: 14 },
        { header: '待处理数量', key: 'newQuantity', width: 14 },
        { header: '处理中数量', key: 'processingQuantity', width: 14 },
        {
          header: '剩余可售库存（参考）',
          key: 'remainingSaleableStock',
          width: 22,
        },
        { header: '最早下单时间', key: 'earliestOrderCreatedAt', width: 26 },
        { header: '数据匹配状态', key: 'matchType', width: 20 },
      ],
      { textKeys: ['productId', 'skuId'] },
    );
    worksheet.addRows(
      summaries.map((summary) => ({
        productId: safeExcelText(summary.productId),
        skuId: safeExcelText(summary.skuId),
        productName: safeExcelText(summary.productName),
        skuName: safeExcelText(summary.skuName),
        skuAttributes: safeExcelText(
          formatSkuAttributes(summary.skuAttributes),
        ),
        requiredQuantity: summary.requiredQuantity,
        orderCount: summary.orderCount,
        newQuantity: summary.newQuantity,
        processingQuantity: summary.processingQuantity,
        remainingSaleableStock: summary.remainingSaleableStock ?? '',
        earliestOrderCreatedAt: summary.earliestOrderCreatedAt,
        matchType: summary.matchType,
      })),
    );
  }

  private addSupplyDetailWorksheet(
    workbook: Workbook,
    details: readonly SupplyExportDetail[],
  ): void {
    const worksheet = workbook.addWorksheet(SUPPLY_DETAIL_SHEET_NAME);
    configureWorksheet(
      worksheet,
      [
        { header: '订单号', key: 'orderNo', width: 24 },
        { header: '订单状态', key: 'status', width: 14 },
        { header: '履约方式', key: 'fulfillmentType', width: 14 },
        { header: '联系人', key: 'contactName', width: 16 },
        { header: '手机号', key: 'contactPhone', width: 18 },
        {
          header: '自提时间或配送地址快照',
          key: 'fulfillmentSnapshot',
          width: 36,
        },
        { header: '商品 ID', key: 'productId', width: 22 },
        { header: 'SKU ID', key: 'skuId', width: 22 },
        { header: '商品名', key: 'productName', width: 24 },
        { header: 'SKU 名', key: 'skuName', width: 20 },
        { header: '规格', key: 'skuAttributes', width: 28 },
        { header: '本单数量', key: 'quantity', width: 12 },
        { header: '成交单价', key: 'unitPrice', width: 14 },
        { header: '行原价', key: 'lineGoodsTotal', width: 14 },
        { header: '行会员优惠', key: 'lineMembershipDiscount', width: 14 },
        { header: '会员折后金额', key: 'linePayable', width: 16 },
        { header: '买家备注', key: 'remark', width: 28 },
        { header: '下单时间', key: 'orderCreatedAt', width: 26 },
      ],
      {
        moneyKeys: [
          'unitPrice',
          'lineGoodsTotal',
          'lineMembershipDiscount',
          'linePayable',
        ],
        textKeys: ['orderNo', 'contactPhone', 'productId', 'skuId'],
      },
    );
    worksheet.addRows(
      details.map((detail) => ({
        orderNo: safeExcelText(detail.orderNo),
        status: detail.status,
        fulfillmentType: safeExcelText(detail.fulfillmentType),
        contactName: safeExcelText(detail.contactName),
        contactPhone: safeExcelText(detail.contactPhone),
        fulfillmentSnapshot: safeExcelText(
          detail.pickupTimeText ?? detail.deliveryAddressText,
        ),
        productId: safeExcelText(detail.productId),
        skuId: safeExcelText(detail.skuId),
        productName: safeExcelText(detail.productName),
        skuName: safeExcelText(detail.skuName),
        skuAttributes: safeExcelText(formatSkuAttributes(detail.skuAttributes)),
        quantity: detail.quantity,
        unitPrice: centsToExcelYuan(detail.unitPriceCents),
        lineGoodsTotal: centsToExcelYuan(detail.lineGoodsTotalCents),
        lineMembershipDiscount: centsToExcelYuan(
          detail.lineMembershipDiscountCents,
        ),
        linePayable: centsToExcelYuan(detail.linePayableCents),
        remark: safeExcelText(detail.remark),
        orderCreatedAt: detail.orderCreatedAt,
      })),
    );
  }

  private async createResult(
    workbook: Workbook,
    view: AdminOrderExportView,
    rowCount: number,
  ): Promise<AdminOrderExportFile> {
    const contents = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
      filename: createFilename(view),
      rowCount,
    };
  }
}
