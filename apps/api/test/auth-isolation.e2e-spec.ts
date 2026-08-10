import { AdminRole } from '@bake-mall/contracts';
import {
  Controller,
  Get,
  INestApplication,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, it, vi } from 'vitest';

import { JwtAdminGuard } from '../src/auth/admin-jwt.guard.js';
import {
  JWT_ADMIN_AUDIENCE,
  JWT_USER_AUDIENCE,
} from '../src/auth/auth.constants.js';
import { JwtUserGuard } from '../src/auth/user-jwt.guard.js';
import { envSchema } from '../src/config/env.schema.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { User } from '../src/database/entities/user.entity.js';

const mockUserRepo = (): Partial<Repository<User>> => ({ findOne: vi.fn() });
const mockAdminRepo = (): Partial<Repository<AdminUser>> => ({
  findOne: vi.fn(),
});

@Controller('admin/isolation-probe')
@UseGuards(JwtAdminGuard)
class AdminProbeController {
  @Get()
  probe() {
    return { ok: true };
  }
}

@Controller('user/isolation-probe')
@UseGuards(JwtUserGuard)
class UserProbeController {
  @Post()
  probe() {
    return { ok: true };
  }
}

describe('Auth isolation (e2e)', () => {
  let app: INestApplication;
  let userToken: string;
  let adminToken: string;
  let userRepo: Partial<Repository<User>>;
  let adminRepo: Partial<Repository<AdminUser>>;
  let persistedUser: User;
  let persistedAdmin: AdminUser;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_USER_SECRET = 'user-secret-for-isolation-test-suite';
    process.env.JWT_ADMIN_SECRET = 'admin-secret-for-isolation-test-suite';
    process.env.MYSQL_HOST = '127.0.0.1';
    process.env.MYSQL_DATABASE = 'bake_mall_test';
    process.env.MYSQL_USER = 'bake_app_test';

    persistedUser = {
      id: '1',
      phone: '13800000000',
      phoneVerified: true,
      isActive: true,
      mergedIntoUserId: null,
      tokenVersion: 1,
    } as User;
    persistedAdmin = {
      id: '42',
      username: 'isolation-admin@example.com',
      role: AdminRole.SUPER_ADMIN,
      linkedUserId: null,
      isActive: true,
      mustChangePassword: false,
      tokenVersion: 1,
    } as AdminUser;
    userRepo = mockUserRepo();
    adminRepo = mockAdminRepo();
    (userRepo.findOne as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { id?: string } }) =>
        where.id === persistedUser.id ? persistedUser : null,
    );
    (adminRepo.findOne as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { id?: string } }) =>
        where.id === persistedAdmin.id ? persistedAdmin : null,
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
            if (error) throw new Error(error.message);
            return { appEnv: value };
          },
        }),
        JwtModule.register({ global: true }),
      ],
      controllers: [AdminProbeController, UserProbeController],
      providers: [
        JwtAdminGuard,
        JwtUserGuard,
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: DataSource,
          useValue: {
            getRepository: (entity: typeof User | typeof AdminUser) =>
              entity === User ? userRepo : adminRepo,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    const jwt = app.get(JwtService);
    userToken = jwt.sign(
      {
        sub: persistedUser.id,
        aud: JWT_USER_AUDIENCE,
        phone: persistedUser.phone,
        tokenVersion: persistedUser.tokenVersion,
      },
      { secret: process.env.JWT_USER_SECRET, expiresIn: 3600 },
    );
    adminToken = jwt.sign(
      {
        sub: persistedAdmin.id,
        aud: JWT_ADMIN_AUDIENCE,
        role: persistedAdmin.role,
        tokenVersion: persistedAdmin.tokenVersion,
        linkedUserId: null,
        mustChangePassword: false,
      },
      { secret: process.env.JWT_ADMIN_SECRET, expiresIn: 3600 },
    );
  });

  beforeEach(() => {
    persistedUser.isActive = true;
    persistedUser.mergedIntoUserId = null;
    persistedUser.tokenVersion = 1;
    persistedAdmin.isActive = true;
    persistedAdmin.tokenVersion = 1;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a user JWT on an admin endpoint', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/isolation-probe')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401);
  });

  it('rejects an admin JWT on a user endpoint', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/user/isolation-probe')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
  });

  it('invalidates user and admin JWTs after persisted version changes', async () => {
    persistedUser.tokenVersion += 1;
    persistedAdmin.tokenVersion += 1;
    await request(app.getHttpServer())
      .post('/api/v1/user/isolation-probe')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/isolation-probe')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
  });

  it('rejects inactive persisted principals', async () => {
    persistedUser.isActive = false;
    persistedAdmin.isActive = false;
    await request(app.getHttpServer())
      .post('/api/v1/user/isolation-probe')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/isolation-probe')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
  });

  it('accepts each token only for its own audience', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/user/isolation-probe')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/admin/isolation-probe')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
