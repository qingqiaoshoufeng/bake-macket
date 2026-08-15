import 'reflect-metadata';

import {
  AdminPermission,
  AdminRole,
  ApiErrorCode,
  OrderStatus,
} from '@bake-mall/contracts';
import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { ADMIN_PERMISSIONS_KEY } from '../src/auth/admin-permission.decorator.js';
import { AdminPermissionGuard } from '../src/auth/admin-permission.guard.js';
import { JwtAdminGuard } from '../src/auth/admin-jwt.guard.js';
import { JWT_ADMIN_AUDIENCE } from '../src/auth/auth.constants.js';
import { AdminBannerController } from '../src/banner/admin-banner.controller.js';
import { BannerService } from '../src/banner/banner.service.js';
import { AdminCategoriesController } from '../src/catalog/admin-categories.controller.js';
import { AdminProductsController } from '../src/catalog/admin-products.controller.js';
import { CatalogService } from '../src/catalog/catalog.service.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { AdminHomepageDraftsController } from '../src/homepage/admin-homepage-drafts.controller.js';
import { AdminHomepageController } from '../src/homepage/admin-homepage.controller.js';
import { HomepageService } from '../src/homepage/homepage.service.js';
import { AdminMembershipPurchasesController } from '../src/membership/admin-membership-purchases.controller.js';
import { AdminMembershipController } from '../src/membership/admin-membership.controller.js';
import { MembershipPurchaseService } from '../src/membership/membership-purchase.service.js';
import { MembershipService } from '../src/membership/membership.service.js';
import { AdminOrderExportService } from '../src/orders/admin-order-export.service.js';
import { AdminOrderQueryService } from '../src/orders/admin-order-query.service.js';
import { AdminOrdersController } from '../src/orders/admin-orders.controller.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { AdminUsersController } from '../src/users/admin-users.controller.js';
import { AdminUsersService } from '../src/users/admin-users.service.js';
import { UploadController } from '../src/upload/upload.controller.js';
import { UploadService } from '../src/upload/upload.service.js';

const ADMIN_SECRET = 'operator-permissions-admin-secret-at-least-32';

const operator = {
  id: '42',
  username: null,
  role: AdminRole.OPERATOR,
  linkedUserId: '7',
  isActive: true,
  mustChangePassword: false,
  tokenVersion: 1,
} as AdminUser;

const superAdmin = {
  id: '43',
  username: 'super-admin',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  isActive: true,
  mustChangePassword: false,
  tokenVersion: 1,
} as AdminUser;

const linkedUser = {
  id: '7',
  phone: null,
  phoneVerified: false,
  wechatOpenid: 'operator-permissions-openid-7',
  wechatUnionid: null,
  isActive: true,
  mergedIntoUserId: null,
} as User;

const serviceStub = {
  create: vi.fn().mockResolvedValue({}),
  createDraft: vi.fn().mockResolvedValue({}),
  createCategory: vi.fn().mockResolvedValue({}),
  createLevel: vi.fn().mockResolvedValue({}),
  createSku: vi.fn().mockResolvedValue({}),
  deleteCategory: vi.fn().mockResolvedValue(undefined),
  deleteLevel: vi.fn().mockResolvedValue(undefined),
  deleteProduct: vi.fn().mockResolvedValue(undefined),
  deleteSku: vi.fn().mockResolvedValue(undefined),
  export: vi.fn().mockResolvedValue({
    buffer: Buffer.from('test export'),
    filename: 'orders.xlsx',
    rowCount: 0,
  }),
  getAdminLevel: vi.fn().mockResolvedValue({}),
  getAdminProduct: vi.fn().mockResolvedValue({}),
  getAdminPurchase: vi.fn().mockResolvedValue({}),
  getAdminView: vi.fn().mockResolvedValue({}),
  getDraft: vi.fn().mockResolvedValue({}),
  getOne: vi.fn().mockResolvedValue({}),
  createPlaceholder: vi.fn().mockResolvedValue({}),
  grantOperator: vi.fn().mockResolvedValue({}),
  list: vi.fn().mockResolvedValue({}),
  listDrafts: vi
    .fn()
    .mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }),
  listAdminCategories: vi.fn().mockResolvedValue({}),
  listAdminLevels: vi.fn().mockResolvedValue({}),
  listAdminProducts: vi.fn().mockResolvedValue({}),
  listAdminPurchases: vi.fn().mockResolvedValue({}),
  listAll: vi.fn().mockResolvedValue({}),
  listSkus: vi.fn().mockResolvedValue([]),
  listSupply: vi.fn().mockResolvedValue({}),
  listSupplyItems: vi.fn().mockResolvedValue({}),
  presign: vi.fn().mockResolvedValue({}),
  publish: vi.fn().mockResolvedValue({}),
  publishDraftById: vi.fn().mockResolvedValue({}),
  record: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  deleteDraft: vi.fn().mockResolvedValue(undefined),
  renameDraft: vi.fn().mockResolvedValue({}),
  revokeOperator: vi.fn().mockResolvedValue({}),
  saveDraft: vi.fn().mockResolvedValue({}),
  saveDraftById: vi.fn().mockResolvedValue({}),
  saveProductAggregate: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
  updateCategory: vi.fn().mockResolvedValue({}),
  updateLevel: vi.fn().mockResolvedValue({}),
  updateLevelStatus: vi.fn().mockResolvedValue({}),
  updateProduct: vi.fn().mockResolvedValue({}),
  updateSku: vi.fn().mockResolvedValue({}),
  updateStatus: vi.fn().mockResolvedValue({}),
  voidPurchase: vi.fn().mockResolvedValue({}),
};

type DeniedEndpoint = {
  name: string;
  method: 'delete' | 'get' | 'patch' | 'post' | 'put';
  path: string;
};

const deniedEndpoints: DeniedEndpoint[] = [
  { name: '订单供货汇总', method: 'get', path: '/api/v1/admin/orders/supply' },
  {
    name: '订单供货明细',
    method: 'get',
    path: '/api/v1/admin/orders/supply-items',
  },
  {
    name: '订单导出',
    method: 'get',
    path: '/api/v1/admin/orders/export?view=ORDER',
  },
  { name: '分类列表', method: 'get', path: '/api/v1/admin/categories' },
  { name: '分类创建', method: 'post', path: '/api/v1/admin/categories' },
  { name: '分类更新', method: 'patch', path: '/api/v1/admin/categories/1' },
  { name: '分类删除', method: 'delete', path: '/api/v1/admin/categories/1' },
  { name: '商品列表', method: 'get', path: '/api/v1/admin/products' },
  { name: '商品创建', method: 'post', path: '/api/v1/admin/products' },
  { name: '商品详情', method: 'get', path: '/api/v1/admin/products/1' },
  { name: '商品整体更新', method: 'put', path: '/api/v1/admin/products/1' },
  { name: '商品部分更新', method: 'patch', path: '/api/v1/admin/products/1' },
  { name: '商品删除', method: 'delete', path: '/api/v1/admin/products/1' },
  { name: 'SKU 列表', method: 'get', path: '/api/v1/admin/products/1/skus' },
  { name: 'SKU 创建', method: 'post', path: '/api/v1/admin/products/1/skus' },
  {
    name: 'SKU 更新',
    method: 'patch',
    path: '/api/v1/admin/products/1/skus/2',
  },
  {
    name: 'SKU 删除',
    method: 'delete',
    path: '/api/v1/admin/products/1/skus/2',
  },
  { name: '轮播图列表', method: 'get', path: '/api/v1/admin/banners' },
  { name: '轮播图创建', method: 'post', path: '/api/v1/admin/banners' },
  { name: '轮播图更新', method: 'patch', path: '/api/v1/admin/banners/1' },
  { name: '轮播图删除', method: 'delete', path: '/api/v1/admin/banners/1' },
  { name: '首页配置读取', method: 'get', path: '/api/v1/admin/homepage' },
  {
    name: '首页草稿保存',
    method: 'put',
    path: '/api/v1/admin/homepage/draft',
  },
  {
    name: '首页配置发布',
    method: 'post',
    path: '/api/v1/admin/homepage/publish',
  },
  {
    name: '首页多草稿列表',
    method: 'get',
    path: '/api/v1/admin/homepage/drafts',
  },
  {
    name: '首页多草稿创建',
    method: 'post',
    path: '/api/v1/admin/homepage/drafts',
  },
  {
    name: '首页多草稿读取',
    method: 'get',
    path: '/api/v1/admin/homepage/drafts/1',
  },
  {
    name: '首页多草稿保存',
    method: 'put',
    path: '/api/v1/admin/homepage/drafts/1',
  },
  {
    name: '首页多草稿重命名',
    method: 'patch',
    path: '/api/v1/admin/homepage/drafts/1',
  },
  {
    name: '首页多草稿删除',
    method: 'delete',
    path: '/api/v1/admin/homepage/drafts/1',
  },
  {
    name: '首页多草稿发布',
    method: 'post',
    path: '/api/v1/admin/homepage/drafts/1/publish',
  },
  {
    name: '会员等级列表',
    method: 'get',
    path: '/api/v1/admin/membership-levels',
  },
  {
    name: '会员等级详情',
    method: 'get',
    path: '/api/v1/admin/membership-levels/1',
  },
  {
    name: '会员等级创建',
    method: 'post',
    path: '/api/v1/admin/membership-levels',
  },
  {
    name: '会员等级更新',
    method: 'put',
    path: '/api/v1/admin/membership-levels/1',
  },
  {
    name: '会员等级状态更新',
    method: 'patch',
    path: '/api/v1/admin/membership-levels/1/status',
  },
  {
    name: '会员等级删除',
    method: 'delete',
    path: '/api/v1/admin/membership-levels/1',
  },
  {
    name: '会员购买列表',
    method: 'get',
    path: '/api/v1/admin/membership-purchases',
  },
  {
    name: '会员购买详情',
    method: 'get',
    path: '/api/v1/admin/membership-purchases/1',
  },
  {
    name: '会员购买作废',
    method: 'post',
    path: '/api/v1/admin/membership-purchases/1/void',
  },
  { name: '上传预签名', method: 'post', path: '/api/v1/upload/presign' },
  {
    name: '授予管理员角色',
    method: 'post',
    path: '/api/v1/admin/users/7/operator/grant',
  },
  {
    name: '撤销管理员角色',
    method: 'post',
    path: '/api/v1/admin/users/7/operator/revoke',
  },
];

describe('Admin endpoint permissions (e2e)', () => {
  let app: INestApplication;
  let operatorToken: string;
  let superAdminToken: string;

  beforeAll(async () => {
    const adminRepository = {
      findOne: vi.fn(
        async ({ where }: { where: { id?: string } }) =>
          [operator, superAdmin].find((admin) => admin.id === where.id) ?? null,
      ),
    };
    const userRepository = {
      findOne: vi.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === linkedUser.id ? linkedUser : null,
      ),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ global: true })],
      controllers: [
        AdminOrdersController,
        AdminCategoriesController,
        AdminProductsController,
        AdminBannerController,
        AdminHomepageController,
        AdminHomepageDraftsController,
        AdminMembershipController,
        AdminMembershipPurchasesController,
        UploadController,
        AdminUsersController,
      ],
      providers: [
        JwtAdminGuard,
        AdminPermissionGuard,
        { provide: OrdersService, useValue: serviceStub },
        { provide: AdminOrderQueryService, useValue: serviceStub },
        { provide: AdminOrderExportService, useValue: serviceStub },
        { provide: AuditService, useValue: serviceStub },
        { provide: CatalogService, useValue: serviceStub },
        { provide: BannerService, useValue: serviceStub },
        { provide: HomepageService, useValue: serviceStub },
        { provide: MembershipService, useValue: serviceStub },
        { provide: MembershipPurchaseService, useValue: serviceStub },
        { provide: UploadService, useValue: serviceStub },
        { provide: AdminUsersService, useValue: serviceStub },
        {
          provide: ConfigService,
          useValue: {
            get: () => ({ JWT_ADMIN_SECRET: ADMIN_SECRET }),
          },
        },
        {
          provide: DataSource,
          useValue: {
            getRepository: (entity: typeof AdminUser | typeof User) =>
              entity === AdminUser ? adminRepository : userRepository,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    const jwt = app.get(JwtService);
    operatorToken = jwt.sign(
      {
        sub: operator.id,
        aud: JWT_ADMIN_AUDIENCE,
        role: operator.role,
        tokenVersion: operator.tokenVersion,
        linkedUserId: operator.linkedUserId,
        mustChangePassword: operator.mustChangePassword,
      },
      { secret: ADMIN_SECRET, expiresIn: 3_600 },
    );
    superAdminToken = jwt.sign(
      {
        sub: superAdmin.id,
        aud: JWT_ADMIN_AUDIENCE,
        role: superAdmin.role,
        tokenVersion: superAdmin.tokenVersion,
        linkedUserId: superAdmin.linkedUserId,
        mustChangePassword: superAdmin.mustChangePassword,
      },
      { secret: ADMIN_SECRET, expiresIn: 3_600 },
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each(deniedEndpoints)('$name 默认拒绝', async ({ method, path }) => {
    const agent = request(app.getHttpServer());
    const response = await agent[method](path)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({});

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      code: ApiErrorCode.ADMIN_PERMISSION_DENIED,
      message: 'Admin permission denied',
    });
  });

  it('允许读取用户列表', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
  });

  it('允许创建 placeholder 用户', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ phone: '13800000000' })
      .expect(201);
  });

  it('允许读取订单列表', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/orders')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
  });

  it('允许读取订单详情', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/orders/1')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
  });

  it('允许更新订单状态', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/admin/orders/1/status')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: OrderStatus.PROCESSING })
      .expect(200);
  });

  it.each([
    ...deniedEndpoints,
    { name: '订单列表', method: 'get' as const, path: '/api/v1/admin/orders' },
    {
      name: '订单详情',
      method: 'get' as const,
      path: '/api/v1/admin/orders/1',
    },
    {
      name: '订单状态更新',
      method: 'patch' as const,
      path: '/api/v1/admin/orders/1/status',
    },
  ])('$name 对 SUPER_ADMIN 放行', async ({ method, path }) => {
    const agent = request(app.getHttpServer());
    const response = await agent[method](path)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: OrderStatus.PROCESSING });

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(response.body).not.toMatchObject({
      code: ApiErrorCode.ADMIN_PERMISSION_DENIED,
    });
  });

  it.each([
    ['list', AdminPermission.ORDER_READ],
    ['getOne', AdminPermission.ORDER_READ],
    ['updateStatus', AdminPermission.ORDER_STATUS_UPDATE],
  ] as const)('%s 声明精确订单权限', (method, permission) => {
    expect(
      app
        .get(Reflector)
        .get<AdminPermission[]>(
          ADMIN_PERMISSIONS_KEY,
          AdminOrdersController.prototype[method],
        ),
    ).toEqual([permission]);
  });
});
