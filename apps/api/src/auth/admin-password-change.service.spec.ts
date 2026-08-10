import {
  AdminPermission,
  AdminRole,
  ApiErrorCode,
  OPERATOR_PERMISSIONS,
} from '@bake-mall/contracts';
import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthService } from './admin-auth.service.js';

const admin = (overrides: Record<string, unknown> = {}) => ({
  id: '9',
  username: null,
  role: AdminRole.OPERATOR,
  linkedUserId: '7',
  passwordHash: 'temporary-hash',
  isActive: true,
  mustChangePassword: true,
  tokenVersion: 2,
  verifyFailedCount: 0,
  verifyWindowStartedAt: null,
  lastPasswordChangedAt: null,
  ...overrides,
});

const principal = (overrides: Record<string, unknown> = {}) => ({
  id: '9',
  username: null,
  role: AdminRole.OPERATOR,
  linkedUserId: '7',
  mustChangePassword: true,
  permissions: [] as AdminPermission[],
  ...overrides,
});

const build = (
  options: {
    persisted?: ReturnType<typeof admin>;
    outcome?: Record<string, unknown>;
  } = {},
) => {
  let persisted = { ...(options.persisted ?? admin()) };
  let transactionReturned = false;
  const repository = {
    findOne: vi.fn().mockResolvedValue(persisted),
    save: vi.fn(async (value) => {
      persisted = { ...value };
      return value;
    }),
  };
  const manager = { getRepository: vi.fn().mockReturnValue(repository) };
  const dataSource = {
    transaction: vi.fn(async (operation) => {
      const result = await operation(manager);
      transactionReturned = true;
      return result;
    }),
  };
  const outcome = options.outcome ?? { status: 'VERIFIED', admin: persisted };
  const verification = {
    verifyInTransaction: vi.fn().mockResolvedValue(outcome),
    assertVerified: vi.fn((result) => {
      if (result.status !== 'VERIFIED') {
        throw new UnauthorizedException({
          code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
        });
      }
      return result;
    }),
    verifyPassword: vi.fn(),
  };
  const audit = { record: vi.fn() };
  const jwt = { sign: vi.fn().mockReturnValue('new-token') };
  const service = new AdminAuthService(
    jwt as never,
    {
      get: vi.fn().mockReturnValue({
        ADMIN_EMAIL: undefined,
        ADMIN_PASSWORD: undefined,
        JWT_ADMIN_SECRET: 'admin-secret',
        JWT_EXPIRES_IN_SECONDS: 3600,
      }),
    } as never,
    repository as never,
    {} as never,
    dataSource as never,
    verification as never,
    audit as never,
  );
  return {
    service,
    repository,
    verification,
    audit,
    getPersisted: () => persisted,
    transactionReturned: () => transactionReturned,
  };
};

describe('首次修改 OPERATOR 临时密码', () => {
  it('验证临时密码后更新 hash/version/时间并直接返回完整会话', async () => {
    const harness = build();
    vi.spyOn(bcrypt, 'hash').mockResolvedValue('new-hash' as never);

    const result = await harness.service.changeInitialOperatorPassword(
      principal(),
      {
        temporaryPassword: '123456',
        newPassword: '654321',
        confirmPassword: '654321',
      },
    );

    expect(harness.verification.verifyInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adminId: '9',
        candidatePassword: '123456',
        context: { purpose: 'INITIAL_PASSWORD_CHANGE' },
      }),
    );
    expect(harness.getPersisted()).toMatchObject({
      passwordHash: 'new-hash',
      mustChangePassword: false,
      tokenVersion: 3,
      verifyFailedCount: 0,
      verifyWindowStartedAt: null,
      lastPasswordChangedAt: expect.any(Date),
    });
    expect(result).toMatchObject({
      role: AdminRole.OPERATOR,
      permissions: OPERATOR_PERMISSIONS,
      mustChangePassword: false,
    });
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain(
      '654321',
    );
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain(
      'hash',
    );
  });

  it.each([
    [
      {
        temporaryPassword: '123456',
        newPassword: '654321',
        confirmPassword: '654320',
      },
    ],
    [
      {
        temporaryPassword: '123456',
        newPassword: 'abc123',
        confirmPassword: 'abc123',
      },
    ],
  ])('拒绝确认不一致或策略不符：%o', async (input) => {
    const harness = build();
    await expect(
      harness.service.changeInitialOperatorPassword(principal(), input),
    ).rejects.toMatchObject({ status: 400 });
    expect(harness.verification.verifyInTransaction).not.toHaveBeenCalled();
  });

  it('不按格式提前拒绝临时密码并始终进入精确验证窗口', async () => {
    const harness = build({
      outcome: {
        status: 'FAILED',
        count: 1,
        windowStartedAt: new Date('2026-08-04T08:00:00.000Z'),
      },
    });

    await expect(
      harness.service.changeInitialOperatorPassword(principal(), {
        temporaryPassword: 'abc123',
        newPassword: '654321',
        confirmPassword: '654321',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
      }),
    });
    expect(harness.verification.verifyInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidatePassword: 'abc123',
        context: { purpose: 'INITIAL_PASSWORD_CHANGE' },
      }),
    );
  });

  it('只接受 mustChangePassword=true 的 OPERATOR principal', async () => {
    await expect(
      build().service.changeInitialOperatorPassword(
        principal({ mustChangePassword: false }),
        {
          temporaryPassword: '123456',
          newPassword: '654321',
          confirmPassword: '654321',
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('验证失败先提交计数事务，再在事务外抛错', async () => {
    const harness = build({
      outcome: {
        status: 'FAILED',
        count: 1,
        windowStartedAt: new Date('2026-08-04T08:00:00.000Z'),
      },
    });

    await expect(
      harness.service.changeInitialOperatorPassword(principal(), {
        temporaryPassword: '000000',
        newPassword: '654321',
        confirmPassword: '654321',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
      }),
    });
    expect(harness.transactionReturned()).toBe(true);
    expect(harness.repository.save).not.toHaveBeenCalled();
  });
});

describe('完整管理员普通改密', () => {
  it.each([
    [
      'OPERATOR',
      admin({ mustChangePassword: false }),
      principal({ mustChangePassword: false }),
      OPERATOR_PERMISSIONS,
    ],
    [
      'SUPER_ADMIN',
      admin({
        id: '1',
        username: 'admin@example.com',
        role: AdminRole.SUPER_ADMIN,
        linkedUserId: null,
        mustChangePassword: false,
      }),
      principal({
        id: '1',
        username: 'admin@example.com',
        role: AdminRole.SUPER_ADMIN,
        linkedUserId: null,
        mustChangePassword: false,
      }),
      OPERATOR_PERMISSIONS,
    ],
  ])(
    '支持%s 并返回新完整 session',
    async (_label, persisted, actor, permissions) => {
      const harness = build({ persisted });
      vi.spyOn(bcrypt, 'hash').mockResolvedValue('ordinary-new-hash' as never);

      const result = await harness.service.changePassword(actor, {
        currentPassword: '123456',
        newPassword: '654321',
        confirmPassword: '654321',
      });

      expect(harness.verification.verifyInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ candidatePassword: '123456' }),
      );
      expect(harness.getPersisted()).toMatchObject({
        passwordHash: 'ordinary-new-hash',
        tokenVersion: 3,
        lastPasswordChangedAt: expect.any(Date),
        mustChangePassword: false,
      });
      expect(result).toMatchObject({
        role: actor.role,
        permissions,
        mustChangePassword: false,
      });
    },
  );

  it('受限 OPERATOR token 不能调用普通改密', async () => {
    await expect(
      build().service.changePassword(principal(), {
        currentPassword: '123456',
        newPassword: '654321',
        confirmPassword: '654321',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    [
      {
        currentPassword: '123456',
        newPassword: '654321',
        confirmPassword: '654320',
      },
    ],
    [
      {
        currentPassword: '123456',
        newPassword: 'abc123',
        confirmPassword: 'abc123',
      },
    ],
  ])('拒绝确认不一致或新密码策略不符：%o', async (input) => {
    const harness = build({
      persisted: admin({ mustChangePassword: false }),
    });
    await expect(
      harness.service.changePassword(
        principal({ mustChangePassword: false }),
        input,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(harness.verification.verifyInTransaction).not.toHaveBeenCalled();
  });

  it('当前密码失败先提交共享窗口，再在事务外抛错', async () => {
    const harness = build({
      persisted: admin({ mustChangePassword: false }),
      outcome: {
        status: 'FAILED',
        count: 2,
        windowStartedAt: new Date('2026-08-04T08:00:00.000Z'),
      },
    });
    await expect(
      harness.service.changePassword(principal({ mustChangePassword: false }), {
        currentPassword: '000000',
        newPassword: '654321',
        confirmPassword: '654321',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
      }),
    });
    expect(harness.transactionReturned()).toBe(true);
  });
});
