import { AdminPermission, AdminRole, ApiErrorCode } from '@bake-mall/contracts';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ADMIN_PERMISSIONS_KEY } from './admin-permission.decorator.js';
import { AdminPermissionGuard } from './admin-permission.guard.js';

const build = (
  principal: Record<string, unknown>,
  metadata?: AdminPermission[],
  requestOverrides: Record<string, unknown> = {},
) => {
  const request = { admin: principal, ...requestOverrides };
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => {
      expect(key).toBe(ADMIN_PERMISSIONS_KEY);
      return metadata;
    }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  return {
    guard: new AdminPermissionGuard(reflector as never, audit as never),
    context,
    audit,
  };
};

const operator = (permissions: AdminPermission[] = []) => ({
  id: '2',
  role: AdminRole.OPERATOR,
  mustChangePassword: false,
  permissions,
});

describe('AdminPermissionGuard', () => {
  it('SUPER_ADMIN 对所有 endpoint 通过且不记录 permission denied', async () => {
    const { guard, context, audit } = build({
      id: '1',
      role: AdminRole.SUPER_ADMIN,
      mustChangePassword: false,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('OPERATOR 对无 metadata endpoint 默认拒绝并记录脱敏审计', async () => {
    const { guard, context, audit } = build(operator());

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(audit.record).toHaveBeenCalledWith({
      actor: { type: 'ADMIN', adminUserId: '2' },
      targetEntity: 'admin_permissions',
      targetId: 'N/A',
      action: 'ADMIN_PERMISSION_DENIED',
      changeSummary: {
        requiredPermission: null,
        role: AdminRole.OPERATOR,
        result: 'DENIED',
      },
    });
  });

  it('完整 OPERATOR 仅允许 principal 持有的显式 permission，允许时不记录拒绝审计', async () => {
    const { guard, context, audit } = build(
      operator([AdminPermission.ORDER_READ]),
      [AdminPermission.ORDER_READ],
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('多权限 endpoint 审计实际缺失的 required permission', async () => {
    const { guard, context, audit } = build(
      operator([AdminPermission.ORDER_READ]),
      [AdminPermission.ORDER_READ, AdminPermission.PRINT_DEVICE_MANAGE],
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        changeSummary: expect.objectContaining({
          requiredPermission: AdminPermission.PRINT_DEVICE_MANAGE,
        }),
      }),
    );
  });

  it.each([
    { permissions: [] as AdminPermission[] },
    { permissions: [AdminPermission.USER_READ] },
  ])(
    'principal permissions 为 $permissions 时拒绝 ORDER_READ',
    async ({ permissions }) => {
      const { guard, context } = build(operator(permissions), [
        AdminPermission.ORDER_READ,
      ]);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it('permission 拒绝记录 action、required permission、角色和可用的规范内部 ID，且不复制请求敏感数据', async () => {
    const secrets = {
      password: 'recovery-password-secret',
      serialNumber: 'SN-PRIVATE-001',
      code: '123456',
      sign: 'vendor-sign-secret',
      token: 'query-token-secret',
    };
    const { guard, context, audit } = build(
      operator([AdminPermission.ORDER_READ]),
      [AdminPermission.PRINT_DEVICE_MANAGE],
      {
        params: { id: '9002' },
        body: secrets,
        query: { token: secrets.token },
        originalUrl: `/admin/cloud-printers/9002/requery?token=${secrets.token}`,
      },
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith({
      actor: { type: 'ADMIN', adminUserId: '2' },
      targetEntity: 'admin_permissions',
      targetId: '9002',
      action: 'ADMIN_PERMISSION_DENIED',
      changeSummary: {
        requiredPermission: AdminPermission.PRINT_DEVICE_MANAGE,
        role: AdminRole.OPERATOR,
        result: 'DENIED',
      },
    });
    const serializedAudit = JSON.stringify(audit.record.mock.calls);
    for (const secret of Object.values(secrets)) {
      expect(serializedAudit).not.toContain(secret);
    }
    expect(serializedAudit).not.toContain('cloud-printers');
  });

  it.each(['0', '01', '-1', 'SN-PRIVATE-001', '18446744073709551616'])(
    '不把非规范内部 ID %s 原值写入审计',
    async (id) => {
      const { guard, context, audit } = build(
        operator(),
        [AdminPermission.PRINT_DEVICE_MANAGE],
        { params: { id } },
      );

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      const recorded = audit.record.mock.calls[0]?.[0];
      expect(recorded).toMatchObject({ targetId: 'N/A' });
      expect(JSON.stringify(recorded)).not.toContain(id);
    },
  );

  it('审计写失败仍保持原 permission 403 结果', async () => {
    const { guard, context, audit } = build(operator(), [
      AdminPermission.PRINT_DEVICE_MANAGE,
    ]);
    audit.record.mockRejectedValueOnce(new Error('audit unavailable'));

    try {
      await guard.canActivate(context);
      expect.fail('Expected guard to reject permission');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual({
        code: ApiErrorCode.ADMIN_PERMISSION_DENIED,
        message: 'Admin permission denied',
      });
    }
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('受限 token 即使 endpoint 声明业务 permission 也以首次改密语义拒绝', async () => {
    const { guard, context } = build(
      { id: '2', role: AdminRole.OPERATOR, mustChangePassword: true },
      [AdminPermission.SELF_PASSWORD_CHANGE],
    );

    try {
      await guard.canActivate(context);
      expect.fail('Expected guard to reject a restricted token');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual({
        code: ApiErrorCode.ADMIN_PASSWORD_CHANGE_REQUIRED,
        message: 'Initial password change is required',
      });
    }
  });
});
