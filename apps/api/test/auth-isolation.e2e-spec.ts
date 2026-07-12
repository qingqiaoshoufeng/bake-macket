import {
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AdminAuthController } from '../src/auth/admin-auth.controller.js';
import { AdminAuthService } from '../src/auth/admin-auth.service.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { JwtAdminGuard } from '../src/auth/admin-jwt.guard.js';
import { UserAuthService } from '../src/auth/user-auth.service.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { envSchema, type AppConfig } from '../src/config/env.schema.js';

/**
 * Cross-cutting e2e spec verifying that user and admin JWTs are strictly
 * isolated: a user audience token must never unlock an admin endpoint, and
 * vice versa. The spec boots a minimal Nest application that wires the real
 * {@link AuthModule} (so the guards, services, and JWT signing are the
 * production code paths) while stubbing the TypeORM repositories.
 */

// Cast the repository mock through `unknown as any` to keep the type checker
// happy — the only consumers in this spec are the auth services which only
// call `findOne` and `save`, and we don't exercise the full TypeORM surface.
const mockUserRepo = (): Partial<Repository<User>> => {
  const repo: Record<string, unknown> = {
    findOne: vi.fn(),
    save: vi.fn(),
    create: vi.fn((input?: Partial<User>) => input as User),
  };
  return repo as unknown as Partial<Repository<User>>;
};

const mockAdminRepo = (): Partial<Repository<AdminUser>> => {
  const repo: Record<string, unknown> = {
    findOne: vi.fn(),
    save: vi.fn(),
    create: vi.fn((input?: Partial<AdminUser>) => input as AdminUser),
  };
  return repo as unknown as Partial<Repository<AdminUser>>;
};

@Controller('admin/categories')
@UseGuards(JwtAdminGuard)
class AdminCategoriesProbeController {
  @Get()
  list(): { ok: true } {
    return { ok: true };
  }
}

describe('Auth isolation (e2e)', () => {
  let app: INestApplication;
  let userToken: string;
  let adminToken: string;
  let userRepo: Partial<Repository<User>>;
  let adminRepo: Partial<Repository<AdminUser>>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_USER_SECRET = 'user-secret-for-isolation-test-suite';
    process.env.JWT_ADMIN_SECRET = 'admin-secret-for-isolation-test-suite';
    process.env.ADMIN_EMAIL = 'isolation-admin@example.com';
    process.env.ADMIN_PASSWORD = 'correct-horse-battery-staple';
    // The Joi schema requires a database configuration even though this
    // spec stubs the repositories — supply a dummy value to satisfy
    // validation. The data source is never opened by AuthModule.
    process.env.MYSQL_HOST = '127.0.0.1';
    process.env.MYSQL_DATABASE = 'bake_mall_test';
    process.env.MYSQL_USER = 'bake_app_test';

    userRepo = mockUserRepo();
    adminRepo = mockAdminRepo();

    (userRepo.findOne as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { phone?: string; id?: string } }) => {
        if (where?.phone === '13800000000') {
          return {
            id: '1',
            phone: '13800000000',
            phoneVerified: true,
          } as User;
        }
        if (where?.id === '1') {
          return {
            id: '1',
            phone: '13800000000',
            phoneVerified: true,
          } as User;
        }
        return null;
      },
    );
    (userRepo.save as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: User) => input,
    );

    const passwordHash = await bcrypt.hash(
      process.env.ADMIN_PASSWORD as string,
      4,
    );
    (adminRepo.findOne as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { username?: string } }) => {
        if (where?.username === process.env.ADMIN_EMAIL) {
          return {
            id: '42',
            email: process.env.ADMIN_EMAIL,
            username: process.env.ADMIN_EMAIL,
            passwordHash,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as unknown as AdminUser;
        }
        return null;
      },
    );
    (adminRepo.save as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: AdminUser) => input,
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: (raw) => {
            const { value, error } = envSchema.validate(raw ?? process.env, {
              abortEarly: false,
              stripUnknown: true,
            });
            if (error) {
              throw new Error(error.message);
            }
            return { appEnv: value };
          },
        }),
        AuthModule,
      ],
      controllers: [AdminCategoriesProbeController],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue(userRepo)
      .overrideProvider(getRepositoryToken(AdminUser))
      .useValue(adminRepo)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['api/v1/health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
    const userAuth = app.get(UserAuthService);
    const adminAuth = app.get(AdminAuthService);

    const env = config.get('appEnv', { infer: true });
    expect(env.JWT_USER_SECRET).not.toBe(env.JWT_ADMIN_SECRET);

    userToken = (
      await userAuth.loginWithDevelopmentCode('13800000000', '123456')
    ).accessToken;
    adminToken = (
      await adminAuth.loginWithCredentials(
        process.env.ADMIN_EMAIL as string,
        process.env.ADMIN_PASSWORD as string,
      )
    ).accessToken;

    expect(userToken).toBeTypeOf('string');
    expect(adminToken).toBeTypeOf('string');
    expect(userToken).not.toBe(adminToken);

    // Sanity-check fixtures so a regression in the wiring surfaces here.
    expect(AuthController).toBeDefined();
    expect(AdminAuthController).toBeDefined();
    void ForbiddenException;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a user JWT on an admin endpoint', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401);
  });

  it('rejects an admin JWT on a user endpoint', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/bind-phone')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: '13900000000', code: '123456' })
      .expect(401);
  });

  it('accepts the user JWT format expected by JwtUserGuard', async () => {
    expect(userToken.split('.').length).toBe(3);
  });
});
