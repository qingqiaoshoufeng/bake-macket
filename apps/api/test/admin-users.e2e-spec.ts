import 'reflect-metadata';

import {
  AdminPermission,
  AdminRole,
  ApiErrorCode,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
} from '@bake-mall/contracts';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
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
import { ADMIN_PERMISSIONS_KEY } from '../src/auth/admin-permission.decorator.js';
import { AdminPermissionGuard } from '../src/auth/admin-permission.guard.js';
import { JwtAdminGuard } from '../src/auth/admin-jwt.guard.js';
import { type AuthenticatedAdmin } from '../src/auth/auth.types.js';
import { AdminVerificationService } from '../src/auth/admin-verification.service.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { AdminUsersController } from '../src/users/admin-users.controller.js';
import { UserIdentityService } from '../src/users/user-identity.service.js';
import { AdminUsersService } from '../src/users/admin-users.service.js';

const operatorPrincipal: AuthenticatedAdmin = {
  id: '42',
  username: null,
  role: AdminRole.OPERATOR,
  linkedUserId: '7',
  mustChangePassword: false,
  permissions: OPERATOR_PERMISSIONS,
};

const superAdminPrincipal: AuthenticatedAdmin = {
  id: '43',
  username: 'admin@example.com',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  mustChangePassword: false,
  permissions: SUPER_ADMIN_PERMISSIONS,
};

const createUserRepository = () => {
  const records: User[] = [
    {
      id: '7',
      nickname: '已有用户',
      phone: '13900000000',
      phoneVerified: true,
      wechatOpenid: 'openid-sensitive-7',
      wechatUnionid: 'unionid-sensitive-7',
      avatarUrl: 'https://cdn.example.com/avatar.webp',
      isActive: true,
      mergedIntoUserId: null,
      tokenVersion: 9,
      createdAt: new Date('2026-08-04T00:00:00.000Z'),
      updatedAt: new Date('2026-08-05T00:00:00.000Z'),
    } as User,
  ];
  const initialRecords = records.map((record) => ({ ...record }));
  const now = new Date('2026-08-05T00:00:00.000Z');
  return {
    records,
    reset: () => {
      records.splice(
        0,
        records.length,
        ...initialRecords.map((record) => ({ ...record })),
      );
    },
    create: vi.fn((value: Partial<User>) => value as User),
    findOne: vi.fn(
      async ({ where }: { where: Partial<User> }) =>
        records.find((record) =>
          Object.entries(where).every(
            ([key, value]) => record[key as keyof User] === value,
          ),
        ) ?? null,
    ),
    save: vi.fn(async (value: User) => {
      const saved = {
        ...value,
        id: String(records.length + 8),
        createdAt: now,
      } as User;
      records.push(saved);
      return saved;
    }),
  };
};

describe('Admin users (e2e)', () => {
  let app: INestApplication;
  const users = createUserRepository();
  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    users.reset();
    audit.record.mockClear();
  });

  beforeAll(async () => {
    const queryBuilder = {
      leftJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getCount: vi.fn().mockResolvedValue(1),
      getRawMany: vi.fn().mockResolvedValue([
        {
          userId: '7',
          nickname: '已有用户',
          phone: '13900000000',
          phoneVerified: 1,
          wechatOpenid: 'openid-sensitive-7',
          wechatUnionid: 'unionid-sensitive-7',
          createdAt: new Date('2026-08-04T00:00:00.000Z'),
          operatorId: '42',
          operatorLoginPhone: '13700000000',
          operatorActive: 1,
          mustChangePassword: 0,
        },
      ]),
    };
    const operators = {
      findOne: vi.fn().mockResolvedValue({
        id: '42',
        role: AdminRole.OPERATOR,
        linkedUserId: '7',
        loginPhone: '13700000000',
        passwordHash: 'operator-password-hash',
        isActive: true,
        mustChangePassword: false,
        tokenVersion: 5,
      }),
    };
    function getRepository(entity: unknown) {
      if (entity === User) {
        return { ...users, createQueryBuilder: vi.fn(() => queryBuilder) };
      }
      if (entity === AdminUser) return operators;
      return {};
    }

    const dataSource = {
      getRepository: vi.fn(getRepository),
      transaction: vi.fn(async (operation) =>
        operation({
          getRepository: (entity: unknown) => (entity === User ? users : {}),
        }),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [
        AdminUsersService,
        Reflector,
        AdminPermissionGuard,
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: audit },
        {
          provide: UserIdentityService,
          useValue: {
            createPhonePlaceholder: vi.fn(async (phone: string) =>
              users.save(
                users.create({
                  phone,
                  phoneVerified: false,
                  nickname: null,
                }),
              ),
            ),
          },
        },
        {
          provide: AdminVerificationService,
          useValue: { verifyInTransaction: vi.fn(), assertVerified: vi.fn() },
        },
      ],
    })
      .overrideGuard(JwtAdminGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): { getRequest(): { headers: Record<string, string> } };
        }) => {
          const req = context.switchToHttp().getRequest() as {
            admin?: AuthenticatedAdmin;
            headers: Record<string, string>;
          };
          req.admin =
            req.headers['x-test-role'] === AdminRole.SUPER_ADMIN
              ? superAdminPrincipal
              : operatorPrincipal;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('OPERATOR 可分页读取脱敏列表且响应无敏感字段', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users?page=1&pageSize=20&q=139')
      .set('x-test-role', AdminRole.OPERATOR)
      .expect(200);

    expect(response.body).toEqual({
      items: [
        {
          id: '7',
          nickname: '已有用户',
          identityPhoneMasked: '139****0000',
          identityPhoneVerified: true,
          wechatBound: true,
          wechatOpenid: 'openid-sensitive-7',
          wechatUnionid: 'unionid-sensitive-7',
          loginPhoneMasked: '137****0000',
          createdAt: '2026-08-04T00:00:00.000Z',
          isOperator: true,
          operatorActive: true,
          mustChangePassword: false,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toMatch(
      /passwordHash|tokenVersion|jwt|session_key|13900000000|13700000000/i,
    );
  });

  it('OPERATOR 可读取完整微信标识且响应无其他原始身份或秘密', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users/7')
      .set('x-test-role', AdminRole.OPERATOR)
      .expect(200);

    expect(response.body).toEqual({
      id: '7',
      nickname: '已有用户',
      avatarUrl: 'https://cdn.example.com/avatar.webp',
      wechat: {
        bound: true,
        openidBound: true,
        unionidBound: true,
        openid: 'openid-sensitive-7',
        unionid: 'unionid-sensitive-7',
      },
      identityPhone: { masked: '139****0000', verified: true },
      account: { isActive: true, mergedIntoUserId: null },
      operator: {
        isOperator: true,
        active: true,
        mustChangePassword: false,
        loginPhoneMasked: '137****0000',
      },
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toMatch(
      /13900000000|13700000000|passwordHash|tokenVersion|jwt|session_key/i,
    );
  });

  it('OPERATOR 可创建 placeholder，响应与审计均脱敏', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set('x-test-role', AdminRole.OPERATOR)
      .send({ phone: ' 13800000000 ' })
      .expect(201);

    expect(response.body).toMatchObject({
      identityPhoneMasked: '138****0000',
      identityPhoneVerified: false,
      wechatBound: false,
      wechatOpenid: null,
      wechatUnionid: null,
      loginPhoneMasked: null,
      isOperator: false,
      operatorActive: false,
      mustChangePassword: false,
    });
    expect(JSON.stringify(response.body)).not.toContain('13800000000');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      '13800000000',
    );
  });

  it('重复手机号返回 shared conflict error', async () => {
    users.records.push({
      ...users.records[0],
      id: '8',
      phone: '13800000000',
    } as User);

    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set('x-test-role', AdminRole.OPERATOR)
      .send({ phone: '13800000000' })
      .expect(409);

    expect(response.body).toEqual({
      code: ApiErrorCode.ADMIN_USER_CONFLICT,
      message: 'User phone already exists',
    });
  });

  it.each([
    [
      'list',
      [AdminPermission.USER_READ, AdminPermission.USER_WECHAT_IDENTITY_READ],
    ],
    [
      'getOne',
      [AdminPermission.USER_READ, AdminPermission.USER_WECHAT_IDENTITY_READ],
    ],
    ['createPlaceholder', [AdminPermission.USER_CREATE]],
  ] as const)('%s 声明精确用户权限', (method, permissions) => {
    expect(
      app
        .get(Reflector)
        .get<AdminPermission[]>(
          ADMIN_PERMISSIONS_KEY,
          AdminUsersController.prototype[method],
        ),
    ).toEqual(permissions);
  });

  it.each(['grant', 'revoke'] as const)(
    '%s 保持无 permission metadata，仅允许 SUPER_ADMIN',
    (method) => {
      expect(
        app
          .get(Reflector)
          .get(ADMIN_PERMISSIONS_KEY, AdminUsersController.prototype[method]),
      ).toBeUndefined();
    },
  );
});
