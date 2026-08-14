import 'reflect-metadata';

import {
  AdminOrderExportView,
  AdminRole,
  FulfillmentType,
  OrderStatus,
  SUPER_ADMIN_PERMISSIONS,
} from '@bake-mall/contracts';
import {
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workbook } from 'exceljs';
import { randomUUID } from 'node:crypto';
import request, { type Response as SupertestResponse } from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JwtAdminGuard } from '../src/auth/admin-jwt.guard.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import { Category } from '../src/database/entities/category.entity.js';
import * as entities from '../src/database/entities/index.js';
import { OrderItem } from '../src/database/entities/order-item.entity.js';
import { Order } from '../src/database/entities/order.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import { Sku } from '../src/database/entities/sku.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { OrdersModule } from '../src/orders/orders.module.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_order_export_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const parseBuffer = (
  responseStream: SupertestResponse,
  callback: (error: Error | null, body: Buffer) => void,
): void => {
  const chunks: Buffer[] = [];
  responseStream.on('data', (chunk: Buffer) => chunks.push(chunk));
  responseStream.on('end', () => callback(null, Buffer.concat(chunks)));
  responseStream.on('error', (error: Error) =>
    callback(error, Buffer.alloc(0)),
  );
};

const loadWorkbook = async (buffer: Buffer): Promise<Workbook> => {
  const workbook = new Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
};

describe.sequential(
  'Admin order export HTTP with real MySQL dependencies',
  () => {
    const rootSql = createDockerRootSqlExecutor();
    let cleanupDatabase: (() => void) | undefined;
    let app: INestApplication | undefined;
    let dataSource: DataSource | undefined;
    let adminId = '';
    let userId = '';
    let orderNo = '';

    beforeAll(async () => {
      try {
        cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
        const moduleRef = await Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({
              isGlobal: true,
              load: [
                () => ({
                  appEnv: {
                    ORDER_QUOTE_TOKEN_SECRET: 'x'.repeat(32),
                    ORDER_QUOTE_TTL_SECONDS: 300,
                  },
                }),
              ],
            }),
            JwtModule.register({ global: true }),
            TypeOrmModule.forRoot({
              type: 'mysql',
              host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
              port: Number(process.env.TEST_MYSQL_PORT ?? 44306),
              database: DATABASE_NAME,
              username: APP_USER,
              password:
                process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
              charset: 'utf8mb4',
              timezone: 'Z',
              synchronize: false,
              entities: Object.values(entities),
              migrations: [...DATABASE_MIGRATIONS],
              migrationsTableName: 'migrations',
              migrationsTransactionMode: 'each',
              migrationsRun: true,
              retryAttempts: 1,
            }),
            OrdersModule,
          ],
        })
          .overrideGuard(JwtAdminGuard)
          .useValue({
            canActivate(context: ExecutionContext): boolean {
              const httpRequest = context.switchToHttp().getRequest<{
                admin?: {
                  id: string;
                  username: string;
                  role: AdminRole;
                  linkedUserId: null;
                  mustChangePassword: false;
                  permissions: typeof SUPER_ADMIN_PERMISSIONS;
                };
              }>();
              httpRequest.admin = {
                id: adminId,
                username: 'export-admin@example.test',
                role: AdminRole.SUPER_ADMIN,
                linkedUserId: null,
                mustChangePassword: false,
                permissions: SUPER_ADMIN_PERMISSIONS,
              };
              return true;
            },
          })
          .compile();

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
        const initializedDataSource = app.get(DataSource);

        const admin = await initializedDataSource.getRepository(AdminUser).save(
          initializedDataSource.getRepository(AdminUser).create({
            username: `export-admin-${process.pid}@example.test`,
            role: AdminRole.SUPER_ADMIN,
            linkedUserId: null,
            passwordHash: 'test-only',
            isActive: true,
            mustChangePassword: false,
            tokenVersion: 1,
          }),
        );
        adminId = admin.id;
        const user = await initializedDataSource.getRepository(User).save(
          initializedDataSource.getRepository(User).create({
            phone: '13911112222',
            phoneVerified: true,
          }),
        );
        userId = user.id;
        const category = await initializedDataSource
          .getRepository(Category)
          .save(
            initializedDataSource.getRepository(Category).create({
              name: '导出集成分类',
              isActive: true,
            }),
          );
        const product = await initializedDataSource.getRepository(Product).save(
          initializedDataSource.getRepository(Product).create({
            name: '导出私密草莓蛋糕',
            categoryId: category.id,
            detailHtml: '<p>export</p>',
            isActive: true,
          }),
        );
        const sku = await initializedDataSource.getRepository(Sku).save(
          initializedDataSource.getRepository(Sku).create({
            productId: product.id,
            name: '6寸',
            attributes: { size: '6寸' },
            priceCents: 6_800,
            stock: 17,
            isActive: true,
          }),
        );
        const orderRepository = initializedDataSource.getRepository(Order);
        const [newOrder, processingOrder] = await orderRepository.save([
          orderRepository.create({
            orderNo: 'BM2026072800000001',
            userId: user.id,
            status: OrderStatus.NEW,
            fulfillmentType: FulfillmentType.PICKUP,
            contactName: '导出联系人甲',
            contactPhone: '13911112222',
            pickupTimeText: '2026-07-29 10:00',
            deliveryAddressText: null,
            goodsTotalCents: 13_600,
            membershipDiscountCents: 1_360,
            creditAppliedCents: 240,
            payableTotalCents: 12_000,
            membershipId: null,
            membershipCode: 'GOLD-SNAPSHOT',
            membershipName: '金卡快照',
            membershipDiscountBasisPoints: 9_000,
            pricingVersion: 1,
            remark: '集成测试备注',
            createdAt: new Date('2026-07-28T01:00:00.000Z'),
            updatedAt: new Date('2026-07-28T01:30:00.000Z'),
          }),
          orderRepository.create({
            orderNo: 'BM2026072800000002',
            userId: user.id,
            status: OrderStatus.PROCESSING,
            fulfillmentType: FulfillmentType.DELIVERY,
            contactName: '导出联系人乙',
            contactPhone: '13911113333',
            pickupTimeText: null,
            deliveryAddressText: '上海市浦东新区集成路 1 号',
            goodsTotalCents: 20_400,
            membershipDiscountCents: 0,
            creditAppliedCents: 0,
            payableTotalCents: 20_400,
            membershipId: null,
            membershipCode: null,
            membershipName: null,
            membershipDiscountBasisPoints: null,
            pricingVersion: 1,
            remark: null,
            createdAt: new Date('2026-07-28T02:00:00.000Z'),
            updatedAt: new Date('2026-07-28T02:30:00.000Z'),
          }),
        ]);
        orderNo = newOrder.orderNo;
        const itemRepository = initializedDataSource.getRepository(OrderItem);
        await itemRepository.save([
          itemRepository.create({
            orderId: newOrder.id,
            productId: product.id,
            skuId: sku.id,
            productName: product.name,
            skuName: sku.name,
            skuAttributes: sku.attributes,
            imageUrl: null,
            unitPriceCents: 6_800,
            quantity: 2,
            lineGoodsTotalCents: 13_600,
            lineMembershipDiscountCents: 1_360,
            linePayableCents: 12_240,
          }),
          itemRepository.create({
            orderId: processingOrder.id,
            productId: product.id,
            skuId: sku.id,
            productName: product.name,
            skuName: sku.name,
            skuAttributes: sku.attributes,
            imageUrl: null,
            unitPriceCents: 6_800,
            quantity: 3,
            lineGoodsTotalCents: 20_400,
            lineMembershipDiscountCents: 0,
            linePayableCents: 20_400,
          }),
        ]);
        dataSource = initializedDataSource;
      } catch (error) {
        await app?.close();
        cleanupDatabase?.();
        cleanupDatabase = undefined;
        throw error;
      }
    }, 60_000);

    afterAll(async () => {
      try {
        await app?.close();
      } finally {
        cleanupDatabase?.();
        cleanupDatabase = undefined;
      }
      expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
        schemaCount: 0,
        grantCount: 0,
      });
    });

    it('downloads ORDER and SUPPLY workbooks and persists only non-PII audit summaries', async () => {
      if (!app || !dataSource)
        throw new Error('MySQL export app is unavailable');

      const orderResponse = await request(app.getHttpServer())
        .get('/api/v1/admin/orders/export')
        .query({
          view: AdminOrderExportView.ORDER,
          orderNo,
          contact: '13911112222',
          userId,
          itemQ: '导出私密草莓蛋糕',
        })
        .buffer(true)
        .parse(parseBuffer)
        .expect('content-type', XLSX_MIME)
        .expect(200);
      const orderWorkbook = await loadWorkbook(orderResponse.body as Buffer);
      const orderSheet = orderWorkbook.getWorksheet('订单列表');

      expect(orderWorkbook.worksheets.map(({ name }) => name)).toEqual([
        '订单列表',
      ]);
      expect(orderSheet?.rowCount).toBe(2);
      expect(orderSheet?.getCell('A2').value).toBe(orderNo);
      expect(orderSheet?.getCell('I2').value).toBe(136);
      expect(orderSheet?.getCell('L2').value).toBe(120);

      const supplyResponse = await request(app.getHttpServer())
        .get('/api/v1/admin/orders/export')
        .query({
          view: AdminOrderExportView.SUPPLY,
          supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
        })
        .buffer(true)
        .parse(parseBuffer)
        .expect('content-type', XLSX_MIME)
        .expect(200);
      const supplyWorkbook = await loadWorkbook(supplyResponse.body as Buffer);
      const summarySheet = supplyWorkbook.getWorksheet('SKU 供货汇总');
      const detailSheet = supplyWorkbook.getWorksheet('订单商品明细');

      expect(supplyWorkbook.worksheets.map(({ name }) => name)).toEqual([
        'SKU 供货汇总',
        '订单商品明细',
      ]);
      expect(summarySheet?.rowCount).toBe(2);
      expect(detailSheet?.rowCount).toBe(3);
      expect(summarySheet?.getCell('F2').value).toBe(5);
      expect(summarySheet?.getCell('G2').value).toBe(2);
      expect(detailSheet?.getCell('M2').value).toBe(68);

      const auditLogs = await dataSource.getRepository(AuditLog).find({
        order: { id: 'ASC' },
      });
      expect(auditLogs).toHaveLength(2);
      expect(auditLogs.map(({ targetId }) => targetId)).toEqual([
        AdminOrderExportView.ORDER,
        AdminOrderExportView.SUPPLY,
      ]);
      expect(auditLogs[0]?.changeSummary).toMatchObject({
        view: AdminOrderExportView.ORDER,
        rowCount: 1,
        filters: {
          orderNoPresent: true,
          contactPresent: true,
          userIdPresent: true,
          itemQPresent: true,
        },
      });
      expect(auditLogs[1]?.changeSummary).toMatchObject({
        view: AdminOrderExportView.SUPPLY,
        rowCount: 2,
        filters: {
          supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
        },
      });
      const auditJson = JSON.stringify(
        auditLogs.map(({ changeSummary }) => changeSummary),
      );
      const auditStringValues = auditJson.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
      expect(auditJson).not.toContain('13911112222');
      expect(auditStringValues).not.toContain(`"${userId}"`);
      expect(auditJson).not.toContain('导出私密草莓蛋糕');
      expect(auditJson).not.toContain(orderNo);
    });
  },
);
