import {
  AdminPermission,
  AdminRole,
  ApiErrorCode,
  OPERATOR_PERMISSIONS,
} from '@bake-mall/contracts';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AdminUser } from '../database/entities/admin-user.entity.js';
import { AdminAuthService } from './admin-auth.service.js';

const config = {
  get: vi.fn().mockReturnValue({
    ADMIN_EMAIL: undefined,
    ADMIN_PASSWORD: undefined,
    JWT_ADMIN_SECRET: 'admin-secret',
    JWT_EXPIRES_IN_SECONDS: 3600,
  }),
};

const operator = (overrides: Record<string, unknown> = {}) => ({
  id: '9',
  username: null,
  loginPhone: '13700000000',
  role: AdminRole.OPERATOR,
  linkedUserId: '7',
  passwordHash: 'operator-hash',
  isActive: true,
  mustChangePassword: true,
  tokenVersion: 2,
  verifyFailedCount: 0,
  verifyWindowStartedAt: null,
  ...overrides,
});

const linkedUser = (overrides: Record<string, unknown> = {}) => ({
  id: '7',
  phone: '13800000000',
  phoneVerified: true,
  orderContactPhone: null,
  wechatOpenid: 'openid-7',
  wechatUnionid: null,
  isActive: true,
  mergedIntoUserId: null,
  ...overrides,
});

const build = (
  options: {
    persistedOperator?: ReturnType<typeof operator> | null;
    persistedUser?: ReturnType<typeof linkedUser> | null;
  } = {},
) => {
  const persistedOperator =
    options.persistedOperator === undefined
      ? operator()
      : options.persistedOperator;
  const persistedUser =
    options.persistedUser === undefined ? linkedUser() : options.persistedUser;
  const admins = {
    findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.loginPhone)
        return where.loginPhone === persistedOperator?.loginPhone
          ? persistedOperator
          : null;
      if (where.linkedUserId) return persistedOperator;
      if (where.id) return persistedOperator;
      return null;
    }),
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
  };
  const users = {
    findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.phone === persistedUser?.phone || where.id === persistedUser?.id
        ? persistedUser
        : null,
    ),
  };
  const jwt = { sign: vi.fn().mockReturnValue('admin-token') };
  const verificationFailed = new UnauthorizedException({
    code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
    message: 'Admin verification failed',
  });
  const verification = {
    verifyPublicLogin: vi.fn(async ({ resolveAdmin }) => {
      const admin = await resolveAdmin({
        getRepository: (entity: unknown) =>
          entity === AdminUser ? admins : users,
      });
      if (!admin) throw verificationFailed;
      return { status: 'VERIFIED', admin };
    }),
    verifyPassword: vi.fn().mockResolvedValue({
      status: 'VERIFIED',
      admin: persistedOperator,
    }),
  };
  const dataSource = { transaction: vi.fn() };
  const audit = { record: vi.fn() };
  const service = new AdminAuthService(
    jwt as never,
    config as never,
    admins as never,
    users as never,
    dataSource as never,
    verification as never,
    audit as never,
  );
  return { service, admins, users, jwt, verification };
};

describe('AdminAuthService OPERATOR 会话', () => {
  it('按独立 AdminUser.loginPhone 登录并签发受限会话', async () => {
    const { service, admins, users, verification, jwt } = build();

    const session = await service.login({
      kind: 'OPERATOR',
      phone: ' 13700000000 ',
      password: '123456',
    });

    expect(admins.findOne).toHaveBeenCalledWith({
      where: { loginPhone: '13700000000' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(users.findOne).toHaveBeenCalledWith({
      where: { id: '7' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(verification.verifyPublicLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        loginKind: 'OPERATOR',
        normalizedIdentifier: '13700000000',
        candidatePassword: '123456',
        resolveAdmin: expect.any(Function),
      }),
    );
    expect(session).toMatchObject({
      role: AdminRole.OPERATOR,
      permissions: [],
      mustChangePassword: true,
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: '9',
        role: AdminRole.OPERATOR,
        tokenVersion: 2,
        linkedUserId: '7',
        mustChangePassword: true,
      }),
      expect.any(Object),
    );
  });

  it.each([
    ['用户不存在', '13700000000', null, operator()],
    [
      '用户 inactive',
      '13700000000',
      linkedUser({ isActive: false }),
      operator(),
    ],
    [
      '用户已合并',
      '13700000000',
      linkedUser({ mergedIntoUserId: '8' }),
      operator(),
    ],
    [
      '用户无微信 identity',
      '13700000000',
      linkedUser({ wechatOpenid: null, wechatUnionid: null }),
      operator(),
    ],
    ['管理员不存在', '13700000000', linkedUser(), null],
    [
      '管理员 inactive',
      '13700000000',
      linkedUser(),
      operator({ isActive: false }),
    ],
    [
      '管理员角色错误',
      '13700000000',
      linkedUser(),
      operator({ role: AdminRole.SUPER_ADMIN }),
    ],
  ])(
    '对%s只走 unknown dummy 路径并返回统一验证异常',
    async (_label, phone, persistedUser, persistedOperator) => {
      const { service, verification } = build({
        persistedUser,
        persistedOperator,
      });
      const error = await service
        .login({ kind: 'OPERATOR', phone, password: '123456' })
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
      expect((error as HttpException).getResponse()).toEqual({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
        message: 'Admin verification failed',
      });
      expect(verification.verifyPublicLogin).toHaveBeenCalledWith(
        expect.objectContaining({
          loginKind: 'OPERATOR',
          normalizedIdentifier: '13700000000',
          candidatePassword: '123456',
          resolveAdmin: expect.any(Function),
        }),
      );
      expect(verification.verifyPassword).not.toHaveBeenCalled();
    },
  );

  it('已知 eligible OPERATOR 即使密码不符合新设密码策略也验证真实 admin', async () => {
    const { service, verification } = build();

    await service.login({
      kind: 'OPERATOR',
      phone: '13700000000',
      password: '12345a',
    });

    expect(verification.verifyPublicLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        loginKind: 'OPERATOR',
        normalizedIdentifier: '13700000000',
        candidatePassword: '12345a',
      }),
    );
  });

  it('有效 mall-user principal 无密码换取完整 OPERATOR 会话', async () => {
    const { service, verification } = build({
      persistedOperator: operator({ mustChangePassword: false }),
    });
    const session = await service.exchangeOperatorSession({
      id: '7',
      phone: '13800000000',
      phoneVerified: true,
    });
    expect(verification.verifyPassword).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      role: AdminRole.OPERATOR,
      permissions: OPERATOR_PERMISSIONS,
      mustChangePassword: false,
    });
  });

  it('linked user 的身份/联系手机号变化不影响换会话', async () => {
    const { service } = build({
      persistedUser: linkedUser({
        phone: null,
        phoneVerified: false,
        orderContactPhone: '13600000000',
      }),
      persistedOperator: operator({ mustChangePassword: false }),
    });
    await expect(
      service.exchangeOperatorSession({
        id: '7',
        phone: '13800000000',
        phoneVerified: true,
      }),
    ).resolves.toMatchObject({ role: AdminRole.OPERATOR });
  });

  it.each([
    [
      '微信 identity 被清空',
      linkedUser({ wechatOpenid: null, wechatUnionid: null }),
    ],
    ['linked user inactive', linkedUser({ isActive: false })],
    ['linked user 已合并', linkedUser({ mergedIntoUserId: '8' })],
  ])('%s 后立即拒绝换会话', async (_label, persistedUser) => {
    const { service } = build({ persistedUser });
    await expect(
      service.exchangeOperatorSession({
        id: '7',
        phone: '13800000000',
        phoneVerified: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('完整会话含精确 permission 白名单', async () => {
    const { service } = build({
      persistedOperator: operator({ mustChangePassword: false }),
    });
    const session = await service.exchangeOperatorSession({
      id: '7',
      phone: '13800000000',
      phoneVerified: true,
    });
    expect(session.permissions).toEqual([
      AdminPermission.ORDER_READ,
      AdminPermission.ORDER_STATUS_UPDATE,
      AdminPermission.USER_READ,
      AdminPermission.USER_CREATE,
      AdminPermission.PRINT_DEVICE_MANAGE,
      AdminPermission.PRINT_EXECUTE,
      AdminPermission.PRINT_HISTORY_READ,
      AdminPermission.SELF_PASSWORD_CHANGE,
    ]);
  });

  it('SUPER_ADMIN 查询与 unknown HMAC 都使用 trim/lowercase 规范邮箱', async () => {
    const harness = build({ persistedOperator: null });
    harness.admins.findOne.mockResolvedValue(null);

    await harness.service
      .loginWithCredentials('  Missing@Example.COM  ', 'legacy-letter-password')
      .catch(() => undefined);

    expect(harness.admins.findOne).toHaveBeenCalledWith({
      where: { username: 'missing@example.com' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(harness.verification.verifyPublicLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        loginKind: 'SUPER_ADMIN',
        normalizedIdentifier: 'missing@example.com',
        candidatePassword: 'legacy-letter-password',
      }),
    );
  });

  it('SUPER_ADMIN 旧非数字密码通过共享验证登录并保持兼容', async () => {
    const superAdmin = operator({
      id: '1',
      username: 'admin@example.com',
      role: AdminRole.SUPER_ADMIN,
      linkedUserId: null,
      mustChangePassword: false,
    });
    const harness = build({ persistedOperator: superAdmin });
    harness.admins.findOne.mockResolvedValue(superAdmin);
    harness.verification.verifyPublicLogin.mockImplementation(
      async ({ resolveAdmin }) => ({
        status: 'VERIFIED',
        admin: await resolveAdmin({
          getRepository: () => harness.admins,
        }),
      }),
    );

    const session = await harness.service.loginWithCredentials(
      'admin@example.com',
      'legacy-letter-password',
    );

    expect(harness.verification.verifyPublicLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        loginKind: 'SUPER_ADMIN',
        normalizedIdentifier: 'admin@example.com',
        candidatePassword: 'legacy-letter-password',
      }),
    );
    expect(session).toMatchObject({
      role: AdminRole.SUPER_ADMIN,
      mustChangePassword: false,
    });
  });

  it.each([
    ['账户不存在', null],
    [
      '账户 inactive',
      operator({ role: AdminRole.SUPER_ADMIN, isActive: false }),
    ],
    ['账户角色错误', operator()],
  ])('SUPER_ADMIN %s时只走 unknown dummy 路径', async (_label, admin) => {
    const harness = build({ persistedOperator: admin });
    harness.admins.findOne.mockResolvedValue(admin);

    const error = await harness.service
      .loginWithCredentials('missing@example.com', 'legacy-letter-password')
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toEqual({
      code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
      message: 'Admin verification failed',
    });
    expect(harness.verification.verifyPublicLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        loginKind: 'SUPER_ADMIN',
        normalizedIdentifier: 'missing@example.com',
        candidatePassword: 'legacy-letter-password',
      }),
    );
    expect(harness.verification.verifyPassword).not.toHaveBeenCalled();
  });
});
