import { AdminRole, OPERATOR_PERMISSIONS } from '@bake-mall/contracts';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { JWT_ADMIN_AUDIENCE } from './auth.constants.js';
import { type AdminJwtPayload } from './auth.types.js';
import { JwtAdminGuard } from './admin-jwt.guard.js';

const admin = (overrides: Record<string, unknown> = {}) => ({
  id: '42',
  username: null,
  role: AdminRole.OPERATOR,
  linkedUserId: '7',
  isActive: true,
  mustChangePassword: false,
  tokenVersion: 3,
  ...overrides,
});

const user = (overrides: Record<string, unknown> = {}) => ({
  id: '7',
  phone: '13800000000',
  phoneVerified: true,
  isActive: true,
  mergedIntoUserId: null,
  ...overrides,
});

const payload = (overrides: Record<string, unknown> = {}): AdminJwtPayload =>
  ({
    sub: '42',
    aud: JWT_ADMIN_AUDIENCE,
    role: AdminRole.OPERATOR,
    tokenVersion: 3,
    linkedUserId: '7',
    mustChangePassword: false,
    ...overrides,
  }) as AdminJwtPayload;

const context = () => {
  const request: Record<string, unknown> = {
    headers: { authorization: 'Bearer admin-token' },
  };
  return {
    request,
    execution: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext,
  };
};

const build = (
  options: {
    token?: AdminJwtPayload;
    persistedAdmin?: ReturnType<typeof admin> | null;
    linkedUser?: ReturnType<typeof user> | null;
  } = {},
) => {
  const jwt = {
    verifyAsync: vi.fn().mockResolvedValue(options.token ?? payload()),
  };
  const config = {
    get: vi.fn().mockReturnValue({ JWT_ADMIN_SECRET: 'admin-secret' }),
  };
  const admins = {
    findOne: vi
      .fn()
      .mockResolvedValue(
        options.persistedAdmin === undefined ? admin() : options.persistedAdmin,
      ),
  };
  const users = {
    findOne: vi
      .fn()
      .mockResolvedValue(
        options.linkedUser === undefined ? user() : options.linkedUser,
      ),
  };
  const dataSource = {
    getRepository: vi.fn((entity) =>
      entity.name === 'AdminUser' ? admins : users,
    ),
  };
  return {
    guard: new JwtAdminGuard(
      jwt as never,
      config as never,
      dataSource as never,
    ),
    admins,
    users,
  };
};

const expectInvalid = async (
  guard: JwtAdminGuard,
  execution: ExecutionContext,
) => {
  await expect(guard.canActivate(execution)).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
};

describe('JwtAdminGuard', () => {
  it('每次从数据库建立 OPERATOR principal', async () => {
    const { guard, admins, users } = build({
      token: payload({ permissions: [] }),
    });
    const { request, execution } = context();

    await expect(guard.canActivate(execution)).resolves.toBe(true);

    expect(admins.findOne).toHaveBeenCalledWith({ where: { id: '42' } });
    expect(users.findOne).toHaveBeenCalledWith({ where: { id: '7' } });
    expect(request.admin).toEqual({
      id: '42',
      username: null,
      role: AdminRole.OPERATOR,
      linkedUserId: '7',
      mustChangePassword: false,
      permissions: OPERATOR_PERMISSIONS,
    });
  });

  it.each([
    ['管理员不存在', null, user()],
    ['管理员 inactive', admin({ isActive: false }), user()],
    ['token version 变化', admin({ tokenVersion: 4 }), user()],
    [
      '角色变化',
      admin({
        role: AdminRole.SUPER_ADMIN,
        username: 'a@b.com',
        linkedUserId: null,
      }),
      user(),
    ],
    ['linked user 不存在', admin(), null],
    ['linked user inactive', admin(), user({ isActive: false })],
    ['linked user 已合并', admin(), user({ mergedIntoUserId: '8' })],
    ['linked phone 未验证', admin(), user({ phoneVerified: false })],
  ])('拒绝%s', async (_label, persistedAdmin, linkedUser) => {
    const { guard } = build({ persistedAdmin, linkedUser });
    await expectInvalid(guard, context().execution);
  });

  it.each(['', '0', '-1', '01', '1.5', '١٢٣', 42, undefined])(
    '在查询数据库前拒绝非法 BIGINT sub：%s',
    async (sub) => {
      const { guard, admins } = build({ token: payload({ sub }) });
      await expectInvalid(guard, context().execution);
      expect(admins.findOne).not.toHaveBeenCalled();
    },
  );

  it('不将大于 MAX_SAFE_INTEGER 的 BIGINT sub 转成 number', async () => {
    const id = '18446744073709551615';
    const { guard, admins } = build({
      token: payload({ sub: id }),
      persistedAdmin: admin({ id }),
    });
    await expect(guard.canActivate(context().execution)).resolves.toBe(true);
    expect(admins.findOne).toHaveBeenCalledWith({ where: { id } });
  });
});
