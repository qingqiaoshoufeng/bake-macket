import {
  Global,
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  AdminRole,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipTheme,
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

let fakeDataSourceRef: unknown;

@Global()
@Module({
  providers: [
    {
      provide: getDataSourceToken(),
      useFactory: () => fakeDataSourceRef,
    },
  ],
  exports: [getDataSourceToken()],
})
class FakeDatabaseModule {}

const view = {
  id: 'purchase-1',
  purchaseNo: 'MP202607210001',
  levelId: 'level-gold',
  levelCode: 'GOLD',
  levelName: '鎏金会员',
  levelRank: 20,
  priceCents: 50_000,
  grantCreditCents: 60_000,
  discountBasisPoints: 9_500,
  validDays: 365,
  cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'GOLD' },
  status: MembershipPurchaseStatus.PENDING,
  paymentStatus: MembershipPaymentStatus.PENDING,
  createdAt: '2026-07-21T08:00:00.000Z',
  updatedAt: '2026-07-21T08:00:00.000Z',
};

describe('Membership purchases (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;
  const userId = '1';
  const persistedUser = {
    id: userId,
    phone: '13800000000',
    phoneVerified: true,
    isActive: true,
    mergedIntoUserId: null as string | null,
    tokenVersion: 1,
  };
  const userFindOne = vi.fn(async ({ where }: { where: { id?: string } }) =>
    where?.id === userId ? { ...persistedUser } : null,
  );
  const purchases = {
    createPurchase: vi.fn().mockResolvedValue(view),
    simulatePayment: vi.fn().mockResolvedValue({
      ...view,
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
    }),
    getOverview: vi.fn(),
    listPurchases: vi.fn(),
    listCreditEntries: vi.fn(),
    listAdminPurchases: vi.fn().mockResolvedValue([]),
    getAdminPurchase: vi.fn().mockResolvedValue({
      purchase: {
        ...view,
        userId: userId,
        benefits: [],
        paymentChannel: 'SIMULATED',
      },
      membershipChain: [],
      grant: null,
      entries: [],
      voidability: { allowed: true },
      segment: null,
    }),
    voidPurchase: vi.fn().mockResolvedValue({
      purchase: {
        ...view,
        userId: userId,
        benefits: [],
        paymentChannel: 'SIMULATED',
        status: MembershipPurchaseStatus.VOIDED,
        paymentStatus: MembershipPaymentStatus.REVERSED,
      },
      membershipChain: [],
      grant: null,
      entries: [],
      voidability: { allowed: false },
      segment: null,
    }),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_USER_SECRET = 'membership-purchase-user-secret';
    process.env.JWT_ADMIN_SECRET = 'membership-purchase-admin-secret';
    process.env.MYSQL_HOST = '127.0.0.1';
    process.env.MYSQL_DATABASE = 'bake_mall_test';
    process.env.MYSQL_USER = 'bake_app_test';

    const persistedAdmin = {
      id: '2',
      username: 'admin@example.test',
      role: AdminRole.SUPER_ADMIN,
      linkedUserId: null,
      passwordHash: 'test-password-hash',
      isActive: true,
      mustChangePassword: false,
      tokenVersion: 1,
    } as AdminUser;
    const adminRepo = {
      findOne: vi.fn(async ({ where }: { where: { id?: string } }) =>
        where?.id === persistedAdmin.id ? persistedAdmin : null,
      ),
      create: vi.fn(),
      save: vi.fn(),
    };
    const repositories = new Map<unknown, object>([[AdminUser, adminRepo]]);
    const fakeDataSource = {
      options: { type: 'mysql' },
      entityMetadatas: [],
      getRepository: vi.fn((entity: unknown) => repositories.get(entity) ?? {}),
    };
    fakeDataSourceRef = fakeDataSource;
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
        FakeDatabaseModule,
        MembershipModule,
      ],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(fakeDataSource)
      .overrideProvider(getRepositoryToken(User))
      .useValue({ findOne: userFindOne })
      .overrideProvider(getRepositoryToken(AdminUser))
      .useValue(adminRepo)
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipLevel))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipPurchaseOrder))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberAccount))
      .useValue({})
      .overrideProvider(getRepositoryToken(UserMembership))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipEntitlementSegment))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditGrant))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditAllocation))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditEntry))
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
      .useValue({ record: vi.fn() })
      .overrideProvider(MembershipService)
      .useValue({})
      .overrideProvider(MembershipPurchaseService)
      .useValue(purchases)
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
    const env = app
      .get<ConfigService<AppConfig, true>>(ConfigService)
      .get('appEnv', { infer: true });
    adminToken = await jwt.signAsync(
      {
        sub: '2',
        aud: JWT_ADMIN_AUDIENCE,
        role: AdminRole.SUPER_ADMIN,
        tokenVersion: 1,
        linkedUserId: null,
        mustChangePassword: false,
      },
      { secret: env.JWT_ADMIN_SECRET },
    );
    userToken = await jwt.signAsync(
      {
        sub: userId,
        phone: '13800000000',
        aud: JWT_USER_AUDIENCE,
        tokenVersion: 1,
      },
      { secret: env.JWT_USER_SECRET },
    );
  });

  afterAll(async () => app?.close());

  it('requires an idempotency key and creates purchases only for verified customers', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/me/membership/purchases')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ levelId: 'level-gold' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/me/membership/purchases')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Idempotency-Key', 'purchase-key-1')
      .send({ levelId: 'level-gold' })
      .expect(201)
      .expect(view);
    expect(userFindOne).toHaveBeenCalledWith({ where: { id: userId } });
    expect(purchases.createPurchase).toHaveBeenCalledWith(
      userId,
      'purchase-key-1',
      { levelId: 'level-gold' },
    );
  });

  it('rejects a persisted placeholder phone before calling purchase service', async () => {
    persistedUser.phoneVerified = false;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/me/membership/purchases')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', 'placeholder-purchase-key')
        .send({ levelId: 'level-gold' })
        .expect(403)
        .expect(({ body }) => {
          expect(body.code).toBe('PHONE_REQUIRED');
        });
      expect(purchases.createPurchase).not.toHaveBeenCalledWith(
        userId,
        'placeholder-purchase-key',
        expect.anything(),
      );
    } finally {
      persistedUser.phoneVerified = true;
    }
  });

  it('requires an idempotency key before simulating payment', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/me/membership/purchases/purchase-1/simulate-payment')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/me/membership/purchases/purchase-1/simulate-payment')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Idempotency-Key', 'payment-key-1')
      .expect(201);
    expect(purchases.simulatePayment).toHaveBeenCalledWith(
      userId,
      'purchase-1',
      'payment-key-1',
    );
  });

  it('keeps customer and admin purchase operations audience-isolated', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/me/membership/purchases/purchase-1/simulate-payment')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/admin/membership-purchases/purchase-1/void')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/admin/membership-purchases/purchase-1/void')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.purchase.status).toBe(MembershipPurchaseStatus.VOIDED);
        expect(body.purchase.paymentStatus).toBe(
          MembershipPaymentStatus.REVERSED,
        );
      });
    expect(purchases.voidPurchase).toHaveBeenCalledWith('purchase-1', '2');
  });

  it('returns the full Admin purchase detail with chain, grant, entries and voidability', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/membership-purchases/purchase-1')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401);

    const { body } = await request(app.getHttpServer())
      .get('/api/v1/admin/membership-purchases/purchase-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body).toMatchObject({
      purchase: { id: 'purchase-1' },
      membershipChain: expect.any(Array),
      entries: expect.any(Array),
      voidability: { allowed: true },
    });
    expect(body).toHaveProperty('grant');
    expect(body).toHaveProperty('segment');
    expect(purchases.getAdminPurchase).toHaveBeenCalledWith('purchase-1');
  });
});
