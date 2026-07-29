import 'reflect-metadata';

import {
  HttpException,
  HttpStatus,
  INestApplication,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  AdminOrderExportView,
  ApiErrorCode,
  BooleanFilter,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { JwtAdminGuard } from '../src/auth/admin-jwt.guard.js';
import {
  JWT_ADMIN_AUDIENCE,
  JWT_USER_AUDIENCE,
} from '../src/auth/auth.constants.js';
import { AdminOrderExportService } from '../src/orders/admin-order-export.service.js';
import { AdminOrderQueryService } from '../src/orders/admin-order-query.service.js';
import { AdminOrdersController } from '../src/orders/admin-orders.controller.js';
import { OrdersService } from '../src/orders/orders.service.js';

const ADMIN_SECRET = 'admin-order-export-admin-secret';
const USER_SECRET = 'admin-order-export-user-secret';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FILE_BUFFER = Buffer.from('mock-xlsx-buffer');

const orders = {
  listAll: vi.fn(),
  getOne: vi.fn(),
  updateStatus: vi.fn(),
};
const orderQueries = {
  listSupply: vi.fn(),
  listSupplyItems: vi.fn(),
};
const orderExports = {
  export: vi.fn(),
};
const audit = {
  record: vi.fn(),
};

describe('Admin order supply and export controller (e2e)', () => {
  let app: INestApplication;
  let adminAuthorization: string;
  let userAuthorization: string;

  beforeAll(async () => {
    const jwt = new JwtService();
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminOrdersController],
      providers: [
        JwtAdminGuard,
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key !== 'appEnv') return undefined;
              return {
                JWT_ADMIN_SECRET: ADMIN_SECRET,
                JWT_USER_SECRET: USER_SECRET,
              };
            },
          },
        },
        { provide: OrdersService, useValue: orders },
        { provide: AdminOrderQueryService, useValue: orderQueries },
        { provide: AdminOrderExportService, useValue: orderExports },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    adminAuthorization = `Bearer ${await jwt.signAsync(
      {
        sub: 'admin-42',
        email: 'admin@example.test',
        aud: JWT_ADMIN_AUDIENCE,
      },
      { secret: ADMIN_SECRET },
    )}`;
    userAuthorization = `Bearer ${await jwt.signAsync(
      {
        sub: 'user-7',
        phone: '13800000000',
        aud: JWT_USER_AUDIENCE,
      },
      { secret: USER_SECRET },
    )}`;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    orders.listAll.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    orders.getOne.mockResolvedValue({ id: 'order-1' });
    orderQueries.listSupply.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    orderQueries.listSupplyItems.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
    orderExports.export.mockResolvedValue({
      buffer: FILE_BUFFER,
      filename: '订单列表_20260728_093000.xlsx',
      rowCount: 12,
    });
    audit.record.mockResolvedValue({ id: 'audit-1' });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('routes repeated supply statuses to the supply query instead of the :id handler', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/orders/supply')
      .query({
        supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
        page: 2,
        pageSize: 20,
      })
      .set('Authorization', adminAuthorization)
      .expect(200);

    expect(response.body).toMatchObject({ page: 1, pageSize: 20, total: 0 });
    expect(orderQueries.listSupply).toHaveBeenCalledWith({
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      page: 2,
      pageSize: 20,
    });
    expect(orders.getOne).not.toHaveBeenCalled();
  });

  it('routes supply item detail queries through the detail DTO', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/orders/supply-items')
      .query({
        groupKey: 'sku:123',
        supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
        page: 1,
        pageSize: 50,
      })
      .set('Authorization', adminAuthorization)
      .expect(200);

    expect(orderQueries.listSupplyItems).toHaveBeenCalledWith({
      groupKey: 'sku:123',
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      page: 1,
      pageSize: 50,
    });
    expect(orders.getOne).not.toHaveBeenCalled();
  });

  it('uses global query validation for the static routes', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/orders/supply')
      .query({ page: 1, pageSize: 20 })
      .set('Authorization', adminAuthorization)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/admin/orders/export')
      .query({
        view: AdminOrderExportView.ORDER,
        supplyStatuses: OrderStatus.NEW,
      })
      .set('Authorization', adminAuthorization)
      .expect(400);

    expect(orderQueries.listSupply).not.toHaveBeenCalled();
    expect(orderExports.export).not.toHaveBeenCalled();
  });

  it('allows mall-admin export, returns the XLSX buffer, and audits only normalized non-PII filters', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/orders/export')
      .query({
        view: AdminOrderExportView.ORDER,
        orderNo: ' BM202607280001 ',
        contact: '13800000000',
        userId: 'user-secret-7',
        itemQ: '私人定制蛋糕',
        status: OrderStatus.PROCESSING,
        fulfillmentType: FulfillmentType.DELIVERY,
        usesMembership: BooleanFilter.YES,
        usesCredit: BooleanFilter.NO,
        hasRemark: BooleanFilter.YES,
        minPayableCents: 1_000,
        maxPayableCents: 20_000,
        createdAtFrom: '2026-07-01T00:00:00.000Z',
        createdAtBefore: '2026-08-01T00:00:00.000Z',
      })
      .set('Authorization', adminAuthorization)
      .buffer(true)
      .parse((responseStream, callback) => {
        const chunks: Buffer[] = [];
        responseStream.on('data', (chunk: Buffer) => chunks.push(chunk));
        responseStream.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect('content-type', XLSX_MIME)
      .expect(
        'content-disposition',
        /attachment; filename\*=UTF-8''%E8%AE%A2%E5%8D%95%E5%88%97%E8%A1%A8_20260728_093000\.xlsx/,
      )
      .expect(200);

    expect(response.body).toEqual(FILE_BUFFER);
    expect(audit.record).toHaveBeenCalledWith({
      adminUserId: 'admin-42',
      targetEntity: 'ORDER_EXPORT',
      targetId: AdminOrderExportView.ORDER,
      action: 'EXPORT',
      changeSummary: {
        view: AdminOrderExportView.ORDER,
        rowCount: 12,
        filters: {
          orderNoPresent: true,
          contactPresent: true,
          userIdPresent: true,
          itemQPresent: true,
          status: OrderStatus.PROCESSING,
          fulfillmentType: FulfillmentType.DELIVERY,
          usesMembership: BooleanFilter.YES,
          usesCredit: BooleanFilter.NO,
          hasRemark: BooleanFilter.YES,
          minPayableCents: 1_000,
          maxPayableCents: 20_000,
          createdAtFrom: '2026-07-01T00:00:00.000Z',
          createdAtBefore: '2026-08-01T00:00:00.000Z',
        },
      },
    });
    const auditPayload = JSON.stringify(audit.record.mock.calls[0]);
    expect(auditPayload).not.toContain('13800000000');
    expect(auditPayload).not.toContain('user-secret-7');
    expect(auditPayload).not.toContain('私人定制蛋糕');
    expect(auditPayload).not.toContain('BM202607280001');
  });

  it('accepts repeated supply statuses for a supply export', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/orders/export')
      .query({
        view: AdminOrderExportView.SUPPLY,
        supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      })
      .set('Authorization', adminAuthorization)
      .expect(200);

    expect(orderExports.export).toHaveBeenCalledWith({
      view: AdminOrderExportView.SUPPLY,
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
    });
  });

  it('rejects a mall-user token from the admin export route', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/orders/export')
      .query({ view: AdminOrderExportView.ORDER })
      .set('Authorization', userAuthorization)
      .expect(401);

    expect(orderExports.export).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns the 422 export envelope without auditing an oversized export', async () => {
    orderExports.export.mockRejectedValueOnce(
      new UnprocessableEntityException({
        code: ApiErrorCode.EXPORT_TOO_LARGE,
        details: { limit: 50_000, rowCount: 50_001 },
      }),
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/orders/export')
      .query({ view: AdminOrderExportView.ORDER })
      .set('Authorization', adminAuthorization)
      .expect(422);

    expect(response.body).toEqual({
      code: ApiErrorCode.EXPORT_TOO_LARGE,
      details: { limit: 50_000, rowCount: 50_001 },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns the 429 export envelope without auditing a concurrent export', async () => {
    orderExports.export.mockRejectedValueOnce(
      new HttpException(
        {
          code: ApiErrorCode.EXPORT_IN_PROGRESS,
          message: '订单导出正在生成中，请稍后重试',
          details: { retry: true },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/orders/export')
      .query({ view: AdminOrderExportView.ORDER })
      .set('Authorization', adminAuthorization)
      .expect(HttpStatus.TOO_MANY_REQUESTS);

    expect(response.body).toEqual({
      code: ApiErrorCode.EXPORT_IN_PROGRESS,
      message: '订单导出正在生成中，请稍后重试',
      details: { retry: true },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not return a successful file when the audit write fails', async () => {
    audit.record.mockRejectedValueOnce(new Error('audit unavailable'));

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/orders/export')
      .query({ view: AdminOrderExportView.ORDER })
      .set('Authorization', adminAuthorization)
      .expect(500);

    expect(response.headers['content-type']).not.toContain('spreadsheetml');
    expect(orderExports.export).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledOnce();
  });
});
