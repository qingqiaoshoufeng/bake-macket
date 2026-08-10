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
      createdAt: new Date('2026-08-04T00:00:00.000Z'),
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
          createdAt: new Date('2026-08-04T00:00:00.000Z'),
          operatorId: '42',
          operatorActive: 1,
          mustChangePassword: 0,
        },
      ]),
    };
    const dataSource = {
      getRepository: vi.fn((entity: unknown) =>
        entity === User
          ? { ...users, createQueryBuilder: vi.fn(() => queryBuilder) }
          : {},
      ),
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
          phoneMasked: '139****0000',
          phoneVerified: true,
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
    expect(JSON.stringify(response.body)).not.toMatch(
      /wechatOpenid|wechatUnionid|passwordHash|tokenVersion|jwt|secret|13900000000/i,
    );
  });

  it('OPERATOR 可创建 placeholder，响应与审计均脱敏', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set('x-test-role', AdminRole.OPERATOR)
      .send({ phone: ' 13800000000 ' })
      .expect(201);

    expect(response.body).toMatchObject({
      phoneMasked: '138****0000',
      phoneVerified: false,
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
    ['list', AdminPermission.USER_READ],
    ['createPlaceholder', AdminPermission.USER_CREATE],
  ] as const)('%s 声明精确用户权限', (method, permission) => {
    expect(
      app
        .get(Reflector)
        .get<AdminPermission[]>(
          ADMIN_PERMISSIONS_KEY,
          AdminUsersController.prototype[method],
        ),
    ).toEqual([permission]);
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
