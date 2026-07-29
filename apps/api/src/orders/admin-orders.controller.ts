import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  AdminOrderExportView,
  type AdminOrderExportQuery,
  type AdminOrderFilterQuery,
} from '@bake-mall/contracts';
import type { Response } from 'express';

import { AuditService } from '../audit/audit.service.js';
import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { AdminOrderExportService } from './admin-order-export.service.js';
import { AdminOrderQueryService } from './admin-order-query.service.js';
import { AdminOrderExportQueryDto } from './dto/admin-order-export-query.dto.js';
import { AdminOrderListQueryDto } from './dto/admin-order-list-query.dto.js';
import { AdminOrderSupplyDetailQueryDto } from './dto/admin-order-supply-detail-query.dto.js';
import { AdminOrderSupplyQueryDto } from './dto/admin-order-supply-query.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { OrdersService } from './orders.service.js';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function toExportQuery(dto: AdminOrderExportQueryDto): AdminOrderExportQuery {
  const { status, supplyStatuses, ...filters } = dto;
  return dto.view === AdminOrderExportView.ORDER
    ? { ...filters, view: AdminOrderExportView.ORDER, status }
    : {
        ...filters,
        view: AdminOrderExportView.SUPPLY,
        supplyStatuses: supplyStatuses!,
      };
}

function summarizeOrderFilters(query: AdminOrderExportQueryDto) {
  const textPresent = (value: string | undefined): boolean =>
    Boolean(value?.trim());
  const filters: Record<string, unknown> = {
    ...(textPresent(query.orderNo) ? { orderNoPresent: true } : {}),
    ...(textPresent(query.contact) ? { contactPresent: true } : {}),
    ...(textPresent(query.userId) ? { userIdPresent: true } : {}),
    ...(textPresent(query.itemQ) ? { itemQPresent: true } : {}),
  };
  const safeKeys = [
    'status',
    'supplyStatuses',
    'fulfillmentType',
    'usesMembership',
    'usesCredit',
    'hasRemark',
    'minPayableCents',
    'maxPayableCents',
    'createdAtFrom',
    'createdAtBefore',
  ] as const satisfies readonly (keyof (AdminOrderFilterQuery &
    AdminOrderExportQueryDto))[];
  for (const key of safeKeys) {
    if (query[key] !== undefined) filters[key] = query[key];
  }
  return filters;
}

/**
 * 商家后台订单端点。查询和导出只读取不可变订单快照；唯一写操作是状态流转，
 * 控制器不提供改写联系人、地址或订单商品内容的路由。
 */
@Controller('admin/orders')
@UseGuards(JwtAdminGuard)
export class AdminOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly orderQueries: AdminOrderQueryService,
    private readonly orderExports: AdminOrderExportService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() query: AdminOrderListQueryDto) {
    return this.orders.listAll(query);
  }

  @Get('supply')
  listSupply(@Query() query: AdminOrderSupplyQueryDto) {
    return this.orderQueries.listSupply(query);
  }

  @Get('supply-items')
  listSupplyItems(@Query() query: AdminOrderSupplyDetailQueryDto) {
    return this.orderQueries.listSupplyItems(query);
  }

  @Get('export')
  async exportOrders(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query() query: AdminOrderExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.orderExports.export(toExportQuery(query));
    await this.audit.record({
      adminUserId: admin.id,
      targetEntity: 'ORDER_EXPORT',
      targetId: query.view,
      action: 'EXPORT',
      changeSummary: {
        view: query.view,
        rowCount: file.rowCount,
        filters: summarizeOrderFilters(query),
      },
    });
    response.setHeader('Content-Type', XLSX_MIME);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    return new StreamableFile(file.buffer);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.orders.getOne(id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.updateStatus(id, dto.status, admin.id);
  }
}
