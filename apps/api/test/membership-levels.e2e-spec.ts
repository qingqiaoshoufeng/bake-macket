import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  MembershipLevelStatus,
  MembershipTheme,
  type SaveMembershipLevelRequest,
} from '@bake-mall/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { AuthModule } from '../src/auth/auth.module.js';
import {
  JWT_ADMIN_AUDIENCE,
  JWT_USER_AUDIENCE,
} from '../src/auth/auth.constants.js';
import { type AppConfig, envSchema } from '../src/config/env.schema.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import { CartItem } from '../src/database/entities/cart-item.entity.js';
import { MemberAccount } from '../src/database/entities/member-account.entity.js';
import { MemberCreditAllocation } from '../src/database/entities/member-credit-allocation.entity.js';
import { MemberCreditEntry } from '../src/database/entities/member-credit-entry.entity.js';
import { MemberCreditGrant } from '../src/database/entities/member-credit-grant.entity.js';
import { IdempotencyRecord } from '../src/database/entities/idempotency-record.entity.js';
import { MembershipEntitlementSegment } from '../src/database/entities/membership-entitlement-segment.entity.js';
import { MembershipLevel } from '../src/database/entities/membership-level.entity.js';
import { MembershipPurchaseOrder } from '../src/database/entities/membership-purchase-order.entity.js';
import { Order } from '../src/database/entities/order.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import { Sku } from '../src/database/entities/sku.entity.js';
import { UserMembership } from '../src/database/entities/user-membership.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { MembershipModule } from '../src/membership/membership.module.js';
import { MembershipPurchaseService } from '../src/membership/membership-purchase.service.js';
import { MembershipService } from '../src/membership/membership.service.js';

const levelRequest: SaveMembershipLevelRequest = {
  code: 'GOLD',
  name: '鎏金会员',
  rank: 20,
  priceCents: 50_000,
  grantCreditCents: 60_000,
  discountBasisPoints: 9_500,
  validDays: 365,
  benefits: [{ title: '全场九五折', sortOrder: 10 }],
  cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'GOLD' },
  sortOrder: 20,
  status: MembershipLevelStatus.ACTIVE,
};

const createLevelRepository = () => {
  const records: MembershipLevel[] = [];
  let nextId = 1;
  const now = () => new Date('2026-07-21T08:00:00.000Z');
  return {
    records,
    find: vi.fn(async ({ where }: { where?: Partial<MembershipLevel> } = {}) =>
      records.filter(
        (record) =>
          !where ||
          Object.entries(where).every(
            ([key, value]) => record[key as keyof MembershipLevel] === value,
          ),
      ),
    ),
    findOneBy: vi.fn(
      async (where: Partial<MembershipLevel>) =>
        records.find((record) =>
          Object.entries(where).every(
            ([key, value]) => record[key as keyof MembershipLevel] === value,
          ),
        ) ?? null,
    ),
    create: vi.fn(
      (value: Partial<MembershipLevel>) => value as MembershipLevel,
    ),
    save: vi.fn(async (value: MembershipLevel) => {
      const saved = {
        ...value,
        id: value.id || String(nextId++),
        version: value.version ?? 1,
        createdAt: value.createdAt ?? now(),
        updatedAt: now(),
      } as MembershipLevel;
      const index = records.findIndex(({ id }) => id === saved.id);
      if (index < 0) records.push(saved);
      else records[index] = saved;
      return saved;
    }),
    update: vi.fn(
      async (
        where: Pick<MembershipLevel, 'id' | 'version'>,
        patch: Partial<MembershipLevel>,
      ) => {
        const index = records.findIndex(
          ({ id, version }) => id === where.id && version === where.version,
        );
        if (index < 0) return { affected: 0 };
        records[index] = {
          ...records[index],
          ...patch,
          version: records[index].version + 1,
          updatedAt: now(),
        };
        return { affected: 1 };
      },
    ),
    delete: vi.fn(async (id: string) => {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return { affected: 0 };
      records.splice(index, 1);
      return { affected: 1 };
    }),
  };
};

describe('Membership levels (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;
  const levels = createLevelRepository();
  const purchases = { count: vi.fn().mockResolvedValue(0) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_USER_SECRET = 'membership-user-secret-for-e2e-tests';
    process.env.JWT_ADMIN_SECRET = 'membership-admin-secret-for-e2e-tests';
    process.env.MYSQL_HOST = '127.0.0.1';
    process.env.MYSQL_DATABASE = 'bake_mall_test';
    process.env.MYSQL_USER = 'bake_app_test';

    const repositories = new Map<unknown, object>([
      [MembershipLevel, levels],
      [MembershipPurchaseOrder, purchases],
    ]);
    const manager = {
      getRepository: (entity: unknown) => repositories.get(entity),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: (raw) => {
            const { value, error } = envSchema.validate(raw ?? process.env, {
              abortEarly: false,
              stripUnknown: true,
            });
            if (error) throw new Error(error.message);
            return { appEnv: value };
          },
        }),
        AuthModule,
        MembershipModule,
      ],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue({ findOneBy: vi.fn() })
      .overrideProvider(getRepositoryToken(AdminUser))
      .useValue({
        findOneBy: vi.fn(),
        findOne: vi.fn().mockResolvedValue(null),
        create: vi.fn((value) => value),
        save: vi.fn(async (value) => value),
      })
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipLevel))
      .useValue(levels)
      .overrideProvider(getRepositoryToken(MembershipPurchaseOrder))
      .useValue(purchases)
      .overrideProvider(getRepositoryToken(MemberAccount))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditGrant))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditEntry))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditAllocation))
      .useValue({})
      .overrideProvider(getRepositoryToken(UserMembership))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipEntitlementSegment))
      .useValue({})
      .overrideProvider(getRepositoryToken(IdempotencyRecord))
      .useValue({})
      .overrideProvider(getRepositoryToken(Order))
      .useValue({})
      .overrideProvider(getRepositoryToken(CartItem))
      .useValue({})
      .overrideProvider(getRepositoryToken(Sku))
      .useValue({})
      .overrideProvider(getRepositoryToken(Product))
      .useValue({})
      .overrideProvider(AuditService)
      .useValue(audit)
      .overrideProvider(MembershipPurchaseService)
      .useValue({})
      .overrideProvider(MembershipService)
      .useFactory({
        factory: () =>
          new MembershipService(
            levels as never,
            purchases as never,
            audit as never,
            {
              transaction: async (
                operation: (transactionManager: typeof manager) => unknown,
              ) => operation(manager),
            } as never,
          ),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    const jwt = app.get(JwtService);
    const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
    const env = config.get('appEnv', { infer: true });
    adminToken = await jwt.signAsync(
      { sub: 'admin-1', email: 'admin@example.test', aud: JWT_ADMIN_AUDIENCE },
      { secret: env.JWT_ADMIN_SECRET },
    );
    userToken = await jwt.signAsync(
      { sub: 'user-1', phone: '13800000000', aud: JWT_USER_AUDIENCE },
      { secret: env.JWT_USER_SECRET },
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates an active level, audits it, and exposes it publicly', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/membership-levels')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(levelRequest)
      .expect(201);

    expect(response.body).toMatchObject({ code: 'GOLD', version: 1 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MEMBERSHIP_LEVEL_CREATED' }),
      expect.any(Object),
    );
    await request(app.getHttpServer())
      .get('/api/v1/public/membership-levels')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ id: response.body.id, code: 'GOLD' }),
        ]);
      });
  });

  it('only accepts admin audience tokens for management routes', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/membership-levels')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/membership-levels')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/admin/membership-levels')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('supports admin/public list and detail with inactive public isolation', async () => {
    const active = levels.records.find(({ code }) => code === 'GOLD');
    expect(active).toBeDefined();

    await request(app.getHttpServer())
      .get('/api/v1/admin/membership-levels')
      .query({ q: 'gold', status: MembershipLevelStatus.ACTIVE })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ id: active?.id, status: 'ACTIVE' }),
        ]);
      });
    await request(app.getHttpServer())
      .get(`/api/v1/admin/membership-levels/${active?.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/public/membership-levels/${active?.id}`)
      .expect(200);

    const inactiveResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/membership-levels')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...levelRequest,
        code: 'SILVER',
        name: '银卡会员',
        rank: 10,
        status: MembershipLevelStatus.INACTIVE,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/admin/membership-levels/${inactiveResponse.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/public/membership-levels/${inactiveResponse.body.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/public/membership-levels')
      .expect(200)
      .expect(({ body }) => {
        expect(body).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: inactiveResponse.body.id }),
          ]),
        );
      });
  });

  it('updates full level data, status, and rejects stale versions', async () => {
    const level = levels.records.find(({ code }) => code === 'GOLD');
    expect(level).toBeDefined();

    const updated = await request(app.getHttpServer())
      .put(`/api/v1/admin/membership-levels/${level?.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...levelRequest, name: '鎏金会员焕新', version: level?.version })
      .expect(200);
    expect(updated.body).toMatchObject({ name: '鎏金会员焕新', version: 2 });

    await request(app.getHttpServer())
      .put(`/api/v1/admin/membership-levels/${level?.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...levelRequest, name: '过期草稿', version: 1 })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('MEMBERSHIP_LEVEL_VERSION_CONFLICT');
      });

    const inactive = await request(app.getHttpServer())
      .patch(`/api/v1/admin/membership-levels/${level?.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: MembershipLevelStatus.INACTIVE, version: 2 })
      .expect(200);
    expect(inactive.body).toMatchObject({ status: 'INACTIVE', version: 3 });
    await request(app.getHttpServer())
      .get(`/api/v1/public/membership-levels/${level?.id}`)
      .expect(404);
  });

  it('returns 404 for missing admin/public levels', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/membership-levels/999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/public/membership-levels/999999')
      .expect(404);
  });

  it('deletes an unsold level and rejects deleting a sold level', async () => {
    const unsold = await request(app.getHttpServer())
      .post('/api/v1/admin/membership-levels')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...levelRequest,
        code: 'BRONZE',
        name: '青铜会员',
        rank: 5,
        status: MembershipLevelStatus.INACTIVE,
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/membership-levels/${unsold.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/membership-levels/${unsold.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    const sold = levels.records.find(({ code }) => code === 'SILVER');
    purchases.count.mockResolvedValueOnce(1);
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/membership-levels/${sold?.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(422)
      .expect(({ body }) => {
        expect(body.message).toBe('已售会员等级不可删除，请改为下架');
      });
  });

  it('requires cardTheme and validates its nested fields', async () => {
    const before = levels.records.length;
    const withoutCardTheme = Object.fromEntries(
      Object.entries(levelRequest).filter(([key]) => key !== 'cardTheme'),
    );

    await request(app.getHttpServer())
      .post('/api/v1/admin/membership-levels')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(withoutCardTheme)
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/admin/membership-levels')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...levelRequest, cardTheme: { theme: 'CUSTOM', badgeText: 1 } })
      .expect(400);

    expect(levels.records).toHaveLength(before);
  });

  it.each([
    ['priceCents negative', { priceCents: -1 }],
    ['priceCents decimal', { priceCents: 1.5 }],
    ['priceCents above UINT32', { priceCents: 4_294_967_296 }],
    ['grantCreditCents negative', { grantCreditCents: -1 }],
    ['grantCreditCents decimal', { grantCreditCents: 1.5 }],
    ['grantCreditCents above UINT32', { grantCreditCents: 4_294_967_296 }],
    ['discountBasisPoints below range', { discountBasisPoints: 999 }],
    ['discountBasisPoints above range', { discountBasisPoints: 10_001 }],
    ['validDays below range', { validDays: 0 }],
    ['validDays above range', { validDays: 3_651 }],
  ])('rejects %s at the HTTP DTO boundary', async (_name, overrides) => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/membership-levels')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...levelRequest, ...overrides })
      .expect(400);
  });

  it('validates admin list query values at runtime', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/membership-levels')
      .query({ status: 'ARCHIVED' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/admin/membership-levels?q[term]=GOLD')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('rejects invalid payloads before persisting a membership level', async () => {
    const before = levels.records.length;
    await request(app.getHttpServer())
      .post('/api/v1/admin/membership-levels')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...levelRequest, code: 'gold' })
      .expect(400);

    expect(levels.records).toHaveLength(before);
  });
});
