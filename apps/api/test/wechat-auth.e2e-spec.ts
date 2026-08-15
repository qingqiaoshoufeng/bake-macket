import { ApiErrorCode } from '@bake-mall/contracts';
import {
  ConflictException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
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

import { AuthController } from '../src/auth/auth.controller.js';
import { JWT_ADMIN_AUDIENCE } from '../src/auth/auth.constants.js';
import { JwtUserGuard } from '../src/auth/user-jwt.guard.js';
import { UserAuthService } from '../src/auth/user-auth.service.js';
import { WechatAuthAdapter } from '../src/auth/wechat-auth.adapter.js';
import { WechatAuthService } from '../src/auth/wechat-auth.service.js';
import { envSchema } from '../src/config/env.schema.js';
import {
  WechatCredentialKind,
  WechatCredentialStatus,
  WechatCredentialUse,
} from '../src/database/entities/wechat-credential-use.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { UserIdentityMergeService } from '../src/users/user-identity-merge.service.js';
import { UserIdentityService } from '../src/users/user-identity.service.js';

const USER_SECRET = 'wechat-e2e-user-secret-at-least-32-characters';
const ADMIN_SECRET = 'wechat-e2e-admin-secret-at-least-32-characters';

type State = {
  users: User[];
  credential: WechatCredentialUse | null;
};

function createUser(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: '1',
    wechatOpenid: null,
    wechatUnionid: null,
    nickname: null,
    avatarUrl: null,
    phone: null,
    phoneVerified: false,
    orderContactPhone: null,
    orderContactPhoneVersion: 0,
    isActive: true,
    mergedIntoUserId: null,
    tokenVersion: 1,
    ...overrides,
  });
}

function createMemoryDataSource(state: State) {
  const credentials = {
    insert: vi.fn(async (value: Partial<WechatCredentialUse>) => {
      if (state.credential) {
        throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      }
      state.credential = Object.assign(new WechatCredentialUse(), {
        id: '1',
        ...value,
      });
      return { identifiers: [{ id: '1' }] };
    }),
    save: vi.fn(async (value: WechatCredentialUse) => {
      state.credential = value;
      return value;
    }),
    createQueryBuilder: vi.fn(() => ({
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn(async () => state.credential),
    })),
  };
  const users = {
    find: vi.fn(async ({ where }: { where: Array<Partial<User>> }) =>
      state.users.filter((candidate) =>
        where.some((selector) =>
          Object.entries(selector).every(
            ([key, value]) => candidate[key as keyof User] === value,
          ),
        ),
      ),
    ),
    findOne: vi.fn(
      async ({ where }: { where: Partial<User> }) =>
        state.users.find((candidate) =>
          Object.entries(where).every(([key, value]) => {
            const current = candidate[key as keyof User];
            return key === 'mergedIntoUserId' && typeof value === 'object'
              ? current === null
              : current === value;
          }),
        ) ?? null,
    ),
    create: vi.fn((value: Partial<User>) =>
      createUser({ id: String(state.users.length + 1), ...value }),
    ),
    save: vi.fn(async (value: User) => {
      state.users = [...state.users.filter(({ id }) => id !== value.id), value];
      return value;
    }),
  };
  const manager = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === WechatCredentialUse) return credentials;
      if (entity === User) return users;
      throw new Error(`unexpected entity ${String(entity)}`);
    }),
  };
  return {
    manager,
    transaction: vi.fn((operation: (value: typeof manager) => unknown) =>
      operation(manager),
    ),
    getRepository: manager.getRepository,
  };
}

describe('WeChat customer auth endpoints (e2e)', () => {
  let app: INestApplication;
  let state: State;
  let adapter: {
    exchangeLoginCode: ReturnType<typeof vi.fn>;
    exchangePhoneCredential: ReturnType<typeof vi.fn>;
  };
  let merge: {
    mergeVerifiedPhone: ReturnType<typeof vi.fn>;
    withPhoneLock: ReturnType<typeof vi.fn>;
    recordRejectedConflict: ReturnType<typeof vi.fn>;
  };
  let jwt: JwtService;

  beforeAll(async () => {
    state = { users: [], credential: null };
    adapter = {
      exchangeLoginCode: vi.fn(),
      exchangePhoneCredential: vi.fn(),
    };
    const dataSource = createMemoryDataSource(state);
    const mergeVerifiedPhone = vi.fn();
    merge = {
      mergeVerifiedPhone,
      withPhoneLock: vi.fn(
        async (
          _phone: string,
          operation: (context: {
            manager: typeof dataSource.manager;
            mergeVerifiedPhone: typeof mergeVerifiedPhone;
          }) => Promise<unknown>,
        ) =>
          operation({
            manager: dataSource.manager,
            mergeVerifiedPhone,
          }),
      ),
      recordRejectedConflict: vi.fn(),
    };
    const userRepository = dataSource.getRepository(User);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: (raw) => {
            const { value, error } = envSchema.validate(
              {
                ...raw,
                NODE_ENV: 'test',
                DATABASE_URL: 'mysql://user:password@localhost:3306/test',
                JWT_USER_SECRET: USER_SECRET,
                JWT_ADMIN_SECRET: ADMIN_SECRET,
              },
              { stripUnknown: true },
            );
            if (error) throw error;
            return { appEnv: value };
          },
        }),
        JwtModule.register({ global: true }),
      ],
      controllers: [AuthController],
      providers: [
        UserAuthService,
        WechatAuthService,
        JwtUserGuard,
        { provide: DataSource, useValue: dataSource },
        { provide: WechatAuthAdapter, useValue: adapter },
        { provide: UserIdentityMergeService, useValue: merge },
        {
          provide: UserIdentityService,
          useValue: {
            createWechatUser: async (identity: {
              openid: string;
              unionid: string | null;
            }) => {
              const created = createUser({
                id: String(state.users.length + 1),
                wechatOpenid: identity.openid,
                wechatUnionid: identity.unionid,
              });
              state.users = [...state.users, created];
              return created;
            },
          },
        },
        { provide: getRepositoryToken(User), useValue: userRepository },
      ],
    })
      .overrideProvider(UserAuthService)
      .useFactory({
        inject: [JwtService],
        factory: (jwtService: JwtService) => ({
          sendDevelopmentCode: vi.fn(),
          loginWithDevelopmentCode: vi.fn(),
          bindPhone: vi.fn(),
          issueSession: (user: User) => ({
            accessToken: jwtService.sign(
              {
                sub: user.id,
                aud: 'mall-user',
                phone: user.phone,
                tokenVersion: user.tokenVersion,
              },
              { secret: USER_SECRET, expiresIn: 3600 },
            ),
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          }),
        }),
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
    jwt = app.get(JwtService);
  });

  beforeEach(() => {
    state.users = [];
    state.credential = null;
    vi.clearAllMocks();
    adapter.exchangeLoginCode.mockResolvedValue({
      openid: 'openid-e2e',
      unionid: 'unionid-e2e',
    });
    adapter.exchangePhoneCredential.mockResolvedValue({
      phoneNumber: '13800000000',
    });
    merge.mergeVerifiedPhone.mockImplementation(
      async ({ authenticatedUserId }: { authenticatedUserId: string }) => {
        const source = state.users.find(({ id }) => id === authenticatedUserId);
        if (!source) throw new Error('missing source user');
        const canonical = createUser({
          ...source,
          id: '9',
          phone: '13800000000',
          phoneVerified: true,
          tokenVersion: source.tokenVersion + 1,
        });
        source.isActive = false;
        source.mergedIntoUserId = canonical.id;
        source.tokenVersion += 1;
        state.users = [source, canonical];
        return {
          userId: canonical.id,
          user: canonical,
          migrated: { addresses: 0, cartItems: 0 },
          operatorChanged: false,
        };
      },
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('logs in with a code and replays from resource without a second vendor call', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code: 'login-e2e-code' })
      .expect(200);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code: 'login-e2e-code' })
      .expect(200);

    expect(first.body.profile).toMatchObject({
      id: '1',
      phoneVerified: false,
    });
    expect(replay.body.profile.id).toBe('1');
    expect(adapter.exchangeLoginCode).toHaveBeenCalledTimes(1);
    expect(state.credential).toMatchObject({
      kind: WechatCredentialKind.LOGIN,
      status: WechatCredentialStatus.COMPLETED,
      resourceUserId: '1',
    });
  });

  it('rejects an expired completed login over HTTP without vendor access or JWT issuance', async () => {
    const completedUser = createUser({
      id: '8',
      wechatOpenid: 'openid-expired-completed',
      tokenVersion: 3,
    });
    state.users = [completedUser];
    state.credential = Object.assign(new WechatCredentialUse(), {
      id: '8',
      kind: WechatCredentialKind.LOGIN,
      credentialHash: 'expired-completed-login-hash',
      status: WechatCredentialStatus.COMPLETED,
      expiresAt: new Date(0),
      resourceUserId: completedUser.id,
      responseSnapshot: {
        version: 1,
        kind: 'COMPLETED',
        resource: { userId: completedUser.id },
        session: { audience: 'mall-user' },
      },
    });
    const sign = vi.spyOn(jwt, 'sign');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code: 'expired-completed-code' })
      .expect(409);

    expect(response.body).toMatchObject({
      code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
    });
    expect(adapter.exchangeLoginCode).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(state.credential).toMatchObject({
      status: WechatCredentialStatus.COMPLETED,
      expiresAt: new Date(0),
      resourceUserId: completedUser.id,
    });
    sign.mockRestore();
  });

  it('maps vendor failures to a stable safe error and replays without vendor', async () => {
    const vendorError = Object.assign(new Error('vendor secret detail'), {
      code: ApiErrorCode.WECHAT_AUTH_FAILED,
      name: 'WechatAuthAdapterError',
    });
    Object.setPrototypeOf(
      vendorError,
      (await import('../src/auth/wechat-auth.adapter.js'))
        .WechatAuthAdapterError.prototype,
    );
    adapter.exchangeLoginCode.mockRejectedValueOnce(vendorError);

    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code: 'bad-code' })
      .expect(401);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code: 'bad-code' })
      .expect(401);

    expect(first.body).toMatchObject({ code: ApiErrorCode.WECHAT_AUTH_FAILED });
    expect(replay.body).toMatchObject({
      code: ApiErrorCode.WECHAT_AUTH_FAILED,
    });
    expect(JSON.stringify([first.body, replay.body])).not.toMatch(
      /bad-code|vendor secret detail/u,
    );
    expect(adapter.exchangeLoginCode).toHaveBeenCalledTimes(1);
  });

  it('replays a FAILED PHONE only to its source principal over HTTP', async () => {
    const source = createUser({
      id: '21',
      wechatOpenid: 'openid-phone-source',
    });
    const other = createUser({ id: '22', wechatOpenid: 'openid-phone-other' });
    state.users = [source, other];
    merge.mergeVerifiedPhone.mockRejectedValueOnce(
      new ConflictException({
        code: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
        message: 'User identity merge requires manual review.',
      }),
    );
    const sourceToken = jwt.sign(
      {
        sub: source.id,
        aud: 'mall-user',
        phone: source.phone,
        tokenVersion: source.tokenVersion,
      },
      { secret: USER_SECRET, expiresIn: 3600 },
    );
    const otherToken = jwt.sign(
      {
        sub: other.id,
        aud: 'mall-user',
        phone: other.phone,
        tokenVersion: other.tokenVersion,
      },
      { secret: USER_SECRET, expiresIn: 3600 },
    );

    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/phone')
      .set('Authorization', `Bearer ${sourceToken}`)
      .send({ code: 'failed-phone-code' })
      .expect(409);
    const sourceReplay = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/phone')
      .set('Authorization', `Bearer ${sourceToken}`)
      .send({ code: 'failed-phone-code' })
      .expect(409);
    const crossUserReplay = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/phone')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ code: 'failed-phone-code' })
      .expect(409);

    expect(first.body).toMatchObject({
      code: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
    });
    expect(sourceReplay.body).toMatchObject({
      code: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
    });
    expect(crossUserReplay.body).toMatchObject({
      code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
    });
    expect(state.credential?.responseSnapshot).toMatchObject({
      version: 2,
      kind: 'FAILED',
      principal: { sourceUserId: source.id },
    });
    expect(adapter.exchangePhoneCredential).toHaveBeenCalledTimes(1);
    expect(merge.mergeVerifiedPhone).toHaveBeenCalledTimes(1);
  });

  it('keeps the real JwtUserGuard: rejects missing/admin auth and merges under mall-user auth', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code: 'login-for-phone' })
      .expect(200);
    // The focused in-memory repository models one credential row at a time;
    // move from the completed LOGIN row to the independent PHONE hash.
    state.credential = null;
    const adminToken = jwt.sign(
      { sub: '42', aud: JWT_ADMIN_AUDIENCE, tokenVersion: 1 },
      { secret: ADMIN_SECRET, expiresIn: 3600 },
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/phone')
      .send({ code: 'phone-e2e-code' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/phone')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'phone-e2e-code' })
      .expect(401);

    const bound = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/phone')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ code: 'phone-e2e-code' })
      .expect(200);

    expect(bound.body.profile).toMatchObject({
      id: '9',
      phone: '138****0000',
      phoneVerified: true,
    });
    const other = createUser({ id: '99', wechatOpenid: 'openid-other' });
    state.users = [...state.users, other];
    const otherToken = jwt.sign(
      {
        sub: other.id,
        aud: 'mall-user',
        phone: other.phone,
        tokenVersion: other.tokenVersion,
      },
      { secret: USER_SECRET, expiresIn: 3600 },
    );
    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/phone')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ code: 'phone-e2e-code' })
      .expect(409);
    expect(replay.body).toMatchObject({
      code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
    });
    expect(adapter.exchangePhoneCredential).toHaveBeenCalledTimes(1);
    expect(merge.mergeVerifiedPhone).toHaveBeenCalledWith({
      authenticatedUserId: '1',
      normalizedPhone: '13800000000',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/phone')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ code: 'another-phone-code' })
      .expect(401);
  });
});
