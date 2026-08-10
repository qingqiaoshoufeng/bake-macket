import {
  AdminPermission,
  AdminRole,
  ApiErrorCode,
  OPERATOR_PERMISSIONS,
} from '@bake-mall/contracts';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuditService } from '../audit/audit.service.js';
import { ADMIN_PERMISSIONS_KEY } from './admin-permission.decorator.js';
import { type AuthenticatedAdmin } from './auth.types.js';

const OPERATOR_PERMISSION_SET = new Set<AdminPermission>(OPERATOR_PERMISSIONS);
const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;

const canonicalTargetId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) return 'N/A';
  return BigInt(value) <= MAX_UNSIGNED_BIGINT ? value : 'N/A';
};

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const admin = (request as Request & { admin?: AuthenticatedAdmin }).admin;
    if (!admin) return false;
    if (admin.role === AdminRole.SUPER_ADMIN) return true;

    const required = this.reflector.getAllAndOverride<AdminPermission[]>(
      ADMIN_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (admin.mustChangePassword) {
      throw new ForbiddenException({
        code: ApiErrorCode.ADMIN_PASSWORD_CHANGE_REQUIRED,
        message: 'Initial password change is required',
      });
    }
    const deniedPermission = required?.find(
      (permission) =>
        !OPERATOR_PERMISSION_SET.has(permission) ||
        !admin.permissions.includes(permission),
    );
    if (!required || required.length === 0 || deniedPermission) {
      try {
        await this.audit.record({
          actor: { type: 'ADMIN', adminUserId: admin.id },
          targetEntity: 'admin_permissions',
          targetId: canonicalTargetId(request.params?.id),
          action: 'ADMIN_PERMISSION_DENIED',
          changeSummary: {
            requiredPermission: deniedPermission ?? null,
            role: admin.role,
            result: 'DENIED',
          },
        });
      } catch {
        // Audit persistence is best effort and must not replace the primary 403.
      }
      throw new ForbiddenException({
        code: ApiErrorCode.ADMIN_PERMISSION_DENIED,
        message: 'Admin permission denied',
      });
    }
    return true;
  }
}
