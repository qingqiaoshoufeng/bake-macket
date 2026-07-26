import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FulfillmentType } from '@bake-mall/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { JWT_USER_AUDIENCE } from '../src/auth/auth.constants.js';
import { type AppConfig, envSchema } from '../src/config/env.schema.js';
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
import { MembershipPricingService } from '../src/membership/membership-pricing.service.js';
import { MembershipPurchaseService } from '../src/membership/membership-purchase.service.js';
import { MembershipService } from '../src/membership/membership.service.js';

describe('Order quote (e2e)', () => {
  let app: INestApplication;
  let userToken: string;
  const pricing = {
    quote: vi.fn().mockResolvedValue({
      lines: [],
      goodsTotalCents: 0,
      membershipDiscountCents: 0,
      discountedTotalCents: 0,
      availableCreditCents: 0,
      maxCreditCents: 0,
      requestedCreditCents: 0,
      creditAppliedCents: 0,
      payableTotalCents: 0,
      membership: null,
      quoteToken: 'quote-token',
      expiresAt: '2026-07-22T08:05:00.000Z',
    }),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_USER_SECRET = 'order-quote-user-secret-at-least-32';
    process.env.JWT_ADMIN_SECRET = 'order-quote-admin-secret-at-least-32';
    process.env.MYSQL_HOST = '127.0.0.1';
    process.env.MYSQL_DATABASE = 'bake_mall_test';
    process.env.MYSQL_USER = 'bake_app_test';
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
      .useValue({
        findOneBy: vi.fn().mockResolvedValue({
          id: 'user-1',
          phone: '13800000000',
          phoneVerified: true,
        }),
      })
      .overrideProvider(getRepositoryToken(AdminUser))
      .useValue({
        findOne: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        save: vi.fn(),
      })
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(CartItem))
      .useValue({})
      .overrideProvider(getRepositoryToken(Sku))
      .useValue({})
      .overrideProvider(getRepositoryToken(Product))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberAccount))
      .useValue({})
      .overrideProvider(getRepositoryToken(UserMembership))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipEntitlementSegment))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipLevel))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipPurchaseOrder))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditGrant))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditEntry))
      .useValue({})
      .overrideProvider(getRepositoryToken(MemberCreditAllocation))
      .useValue({})
      .overrideProvider(getRepositoryToken(IdempotencyRecord))
      .useValue({})
      .overrideProvider(getRepositoryToken(Order))
      .useValue({})
      .overrideProvider(AuditService)
      .useValue({ record: vi.fn() })
      .overrideProvider(MembershipService)
      .useValue({})
      .overrideProvider(MembershipPurchaseService)
      .useValue({})
      .overrideProvider(MembershipPricingService)
      .useValue(pricing)
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
    userToken = await jwt.signAsync(
      { sub: 'user-1', phone: '13800000000', aud: JWT_USER_AUDIENCE },
      { secret: env.JWT_USER_SECRET },
    );
  });

  afterAll(async () => app?.close());

  it('requires customer authentication and validates integer credit cents', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders/quote')
      .send({ cartItemIds: ['cart-1'], requestedCreditCents: 0 })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/orders/quote')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ cartItemIds: ['cart-1'], requestedCreditCents: 0.5 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/orders/quote')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ cartItemIds: ['cart-1'], requestedCreditCents: 300 })
      .expect(201)
      .expect(({ body }) => expect(body.quoteToken).toBe('quote-token'));
    expect(pricing.quote).toHaveBeenCalledWith('user-1', {
      cartItemIds: ['cart-1'],
      requestedCreditCents: 300,
    });
    void FulfillmentType;
  });
});
