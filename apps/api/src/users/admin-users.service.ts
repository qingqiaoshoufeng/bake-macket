import {
  AdminRole,
  ApiErrorCode,
  type AdminUserListQuery,
  type AdminUserPage,
  type AdminUserStatusView,
  type AdminUserView,
  type CreatePlaceholderUserRequest,
  type GrantOperatorRequest,
  type RevokeOperatorRequest,
} from '@bake-mall/contracts';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { ADMIN_BCRYPT_COST } from '../auth/admin-auth.service.js';
import { validateAdminPassword } from '../auth/admin-password-policy.js';
import { type AuthenticatedAdmin } from '../auth/auth.types.js';
import { isEligibleOperatorLinkedUser } from '../auth/operator-linked-user-eligibility.js';
import { AdminVerificationService } from '../auth/admin-verification.service.js';
import { escapeLike } from '../common/query/admin-query.helpers.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';
import { User } from '../database/entities/user.entity.js';
import {
  UserIdentityService,
  normalizeOperatorPhone,
} from './user-identity.service.js';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly verification: AdminVerificationService,
    private readonly audit: AuditService,
    private readonly userIdentity: UserIdentityService,
  ) {}

  async list(query: AdminUserListQuery): Promise<AdminUserPage> {
    const builder = this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .leftJoin(
        AdminUser,
        'operator',
        'operator.linkedUserId = user.id AND operator.role = :operatorRole',
        { operatorRole: AdminRole.OPERATOR },
      )
      .select([
        'user.id AS userId',
        'user.nickname AS nickname',
        'user.phone AS phone',
        'user.phoneVerified AS phoneVerified',
        '(user.wechatOpenid IS NOT NULL OR user.wechatUnionid IS NOT NULL) AS wechatBound',
        'user.createdAt AS createdAt',
        'operator.id AS operatorId',
        'operator.loginPhone AS operatorLoginPhone',
        'operator.isActive AS operatorActive',
        'operator.mustChangePassword AS mustChangePassword',
      ]);
    const q = query.q?.trim();
    if (q) {
      const exactUserId = toExactUserId(q);
      const searchConditions =
        "user.phone LIKE :search ESCAPE '\\\\' OR user.nickname LIKE :search ESCAPE '\\\\' OR operator.loginPhone = :exactLoginPhone";
      builder.andWhere(
        exactUserId === null
          ? `(${searchConditions})`
          : `(${searchConditions} OR user.id = :exactUserId)`,
        {
          exactLoginPhone: q,
          search: `%${escapeLike(q)}%`,
          ...(exactUserId === null ? {} : { exactUserId }),
        },
      );
    }
    const total = await builder.getCount();
    const rows = await builder
      .orderBy('user.createdAt', 'DESC')
      .addOrderBy('user.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getRawMany<AdminUserRaw>();
    return {
      items: rows.map(toAdminUserView),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createPlaceholder(
    principal: AuthenticatedAdmin,
    input: CreatePlaceholderUserRequest,
  ): Promise<AdminUserView> {
    const phone = normalizeOperatorPhone(input.phone);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const users = manager.getRepository(User);
        const existing = await users.findOne({ where: { phone } });
        if (existing) throw userPhoneConflict();
        const saved = await this.userIdentity.createPhonePlaceholder(
          phone,
          manager,
        );
        await this.audit.record(
          {
            actor: { type: 'ADMIN', adminUserId: principal.id },
            targetEntity: 'users',
            targetId: saved.id,
            action: 'ADMIN_PLACEHOLDER_USER_CREATED',
            changeSummary: { userId: saved.id, phonePresent: true },
          },
          manager,
        );
        return userView(saved, null);
      });
    } catch (error) {
      if (isDuplicateEntry(error)) throw userPhoneConflict();
      throw error;
    }
  }

  async grantOperator(
    userId: string,
    principal: AuthenticatedAdmin,
    input: GrantOperatorRequest,
  ): Promise<AdminUserStatusView> {
    assertSuperAdmin(principal);
    if (
      input.temporaryPassword !== input.confirmTemporaryPassword ||
      !validateAdminPassword(input.temporaryPassword).ok
    ) {
      throw new BadRequestException({
        code: ApiErrorCode.ADMIN_PASSWORD_POLICY_VIOLATION,
        message: 'Temporary password is invalid',
      });
    }
    const loginPhone = normalizeOperatorPhone(input.loginPhone);
    try {
      const outcome = await withDeadlockRetry(() =>
        this.dataSource.transaction(async (manager) => {
          const user = await manager.getRepository(User).findOne({
            where: { id: userId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!isEligibleOperatorLinkedUser(user)) {
            throw new ConflictException({
              code: ApiErrorCode.ADMIN_USER_CONFLICT,
              message: 'User is not eligible for operator authorization',
            });
          }
          const admins = manager.getRepository(AdminUser);
          const existing = await admins.findOne({
            where: { linkedUserId: user.id },
            lock: { mode: 'pessimistic_write' },
          });
          const loginPhoneOwner = await admins.findOne({
            where: { loginPhone },
            lock: { mode: 'pessimistic_write' },
          });
          if (loginPhoneOwner && loginPhoneOwner.id !== existing?.id) {
            throw adminLoginPhoneConflict();
          }
          if (existing?.isActive) {
            throw new ConflictException({
              code: ApiErrorCode.ADMIN_USER_CONFLICT,
              message: 'User is already an active operator',
            });
          }
          const verification = await this.verification.verifyInTransaction(
            manager,
            {
              adminId: principal.id,
              candidatePassword: input.currentPassword,
              now: new Date(),
              context: { purpose: 'HIGH_RISK_ACTION' },
            },
          );
          if (verification.status !== 'VERIFIED') {
            return { verification } as const;
          }
          const passwordHash = await bcrypt.hash(
            input.temporaryPassword,
            ADMIN_BCRYPT_COST,
          );
          const operator =
            existing ??
            admins.create({
              username: null,
              role: AdminRole.OPERATOR,
              linkedUserId: user.id,
              tokenVersion: 0,
            });
          operator.username = null;
          operator.loginPhone = loginPhone;
          operator.role = AdminRole.OPERATOR;
          operator.linkedUserId = user.id;
          operator.passwordHash = passwordHash;
          operator.isActive = true;
          operator.mustChangePassword = true;
          operator.tokenVersion += 1;
          operator.verifyFailedCount = 0;
          operator.verifyWindowStartedAt = null;
          const saved = await admins.save(operator);
          await this.recordChange(
            manager,
            principal.id,
            saved,
            'ADMIN_OPERATOR_GRANTED',
          );
          return { operator: saved } as const;
        }),
      );
      if ('verification' in outcome && outcome.verification) {
        this.verification.assertVerified(outcome.verification);
        throw new Error('unreachable');
      }
      return statusView(userId, outcome.operator);
    } catch (error) {
      if (isDuplicateEntry(error)) throw adminLoginPhoneConflict();
      throw error;
    }
  }

  async revokeOperator(
    userId: string,
    principal: AuthenticatedAdmin,
    input: RevokeOperatorRequest,
  ): Promise<AdminUserStatusView> {
    assertSuperAdmin(principal);
    const outcome = await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found');
      const admins = manager.getRepository(AdminUser);
      const operator = await admins.findOne({
        where: { linkedUserId: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!operator || operator.role !== AdminRole.OPERATOR) {
        throw new NotFoundException('Operator not found');
      }
      if (operator.id === principal.id) {
        throw new ForbiddenException('Cannot revoke current super admin');
      }
      const verification = await this.verification.verifyInTransaction(
        manager,
        {
          adminId: principal.id,
          candidatePassword: input.currentPassword,
          now: new Date(),
          context: { purpose: 'HIGH_RISK_ACTION' },
        },
      );
      if (verification.status !== 'VERIFIED') {
        return { verification } as const;
      }
      operator.isActive = false;
      operator.tokenVersion += 1;
      const saved = await admins.save(operator);
      await this.recordChange(
        manager,
        principal.id,
        saved,
        'ADMIN_OPERATOR_REVOKED',
      );
      return { operator: saved } as const;
    });
    if ('verification' in outcome && outcome.verification) {
      this.verification.assertVerified(outcome.verification);
      throw new Error('unreachable');
    }
    return statusView(userId, outcome.operator);
  }

  private async recordChange(
    manager: EntityManager,
    actorAdminId: string,
    operator: AdminUser,
    action: string,
  ): Promise<void> {
    await this.audit.record(
      {
        actor: { type: 'ADMIN', adminUserId: actorAdminId },
        targetEntity: 'admin_users',
        targetId: operator.id,
        action,
        changeSummary: {
          role: operator.role,
          isActive: operator.isActive,
          mustChangePassword: operator.mustChangePassword,
          tokenVersion: operator.tokenVersion,
          linkedUserId: operator.linkedUserId,
          loginPhonePresent: operator.loginPhone !== null,
          loginPhoneMasked: maskAdminUserPhone(operator.loginPhone),
        },
      },
      manager,
    );
  }
}

const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;

const toExactUserId = (value: string): string | null => {
  if (!/^[1-9]\d*$/.test(value)) return null;
  return BigInt(value) <= MAX_UNSIGNED_BIGINT ? value : null;
};

type AdminUserRaw = {
  userId: string;
  nickname: string | null;
  phone: string | null;
  phoneVerified: boolean | number | string;
  wechatBound: boolean | number | string;
  createdAt: Date | string;
  operatorId: string | null;
  operatorLoginPhone: string | null;
  operatorActive: boolean | number | string | null;
  mustChangePassword: boolean | number | string | null;
};

const toBoolean = (value: boolean | number | string | null): boolean =>
  value === true || value === 1 || value === '1';

export const maskAdminUserPhone = (
  phone: string | null | undefined,
): string | null => {
  if (phone == null) return null;
  if (phone.length <= 7) {
    return `${phone.slice(0, 1)}${'*'.repeat(Math.max(4, phone.length - 2))}${phone.slice(-1)}`;
  }
  const prefixLength = phone.startsWith('+') ? 3 : phone.length === 11 ? 3 : 3;
  const suffixLength =
    phone.length === 11 ? 4 : Math.min(4, phone.length - prefixLength - 1);
  const hiddenLength = Math.max(4, phone.length - prefixLength - suffixLength);
  return `${phone.slice(0, prefixLength)}${'*'.repeat(hiddenLength)}${phone.slice(-suffixLength)}`;
};

const userView = (
  user: Pick<
    User,
    | 'id'
    | 'nickname'
    | 'phone'
    | 'phoneVerified'
    | 'wechatOpenid'
    | 'wechatUnionid'
    | 'createdAt'
  >,
  operator: Pick<
    AdminUser,
    'id' | 'loginPhone' | 'isActive' | 'mustChangePassword'
  > | null,
): AdminUserView => ({
  id: user.id,
  nickname: user.nickname,
  identityPhoneMasked: maskAdminUserPhone(user.phone),
  identityPhoneVerified: user.phoneVerified,
  wechatBound: Boolean(user.wechatOpenid || user.wechatUnionid),
  loginPhoneMasked: maskAdminUserPhone(operator?.loginPhone ?? null),
  createdAt: user.createdAt.toISOString(),
  isOperator: operator !== null,
  operatorActive: operator?.isActive ?? false,
  mustChangePassword: operator?.mustChangePassword ?? false,
});

const toAdminUserView = (row: AdminUserRaw): AdminUserView => ({
  id: row.userId,
  nickname: row.nickname,
  identityPhoneMasked: maskAdminUserPhone(row.phone),
  identityPhoneVerified: toBoolean(row.phoneVerified),
  wechatBound: toBoolean(row.wechatBound),
  loginPhoneMasked: maskAdminUserPhone(row.operatorLoginPhone ?? null),
  createdAt: new Date(row.createdAt).toISOString(),
  isOperator: row.operatorId !== null,
  operatorActive: toBoolean(row.operatorActive),
  mustChangePassword: toBoolean(row.mustChangePassword),
});

const userPhoneConflict = () =>
  new ConflictException({
    code: ApiErrorCode.ADMIN_USER_CONFLICT,
    message: 'User phone already exists',
  });

const adminLoginPhoneConflict = () =>
  new ConflictException({
    code: ApiErrorCode.ADMIN_LOGIN_PHONE_CONFLICT,
    message: 'Admin login phone already exists',
  });

const isDeadlock = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (('code' in error &&
    (error as { code?: string }).code === 'ER_LOCK_DEADLOCK') ||
    ('errno' in error && (error as { errno?: number }).errno === 1213));

async function withDeadlockRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isDeadlock(error)) throw error;
    return operation();
  }
}

const isDuplicateEntry = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (('code' in error && (error as { code?: string }).code === 'ER_DUP_ENTRY') ||
    ('errno' in error && (error as { errno?: number }).errno === 1062));

const assertSuperAdmin = (principal: AuthenticatedAdmin): void => {
  if (principal.role !== AdminRole.SUPER_ADMIN) {
    throw new ForbiddenException({
      code: ApiErrorCode.ADMIN_PERMISSION_DENIED,
      message: 'Only super admins may manage operators',
    });
  }
};

const statusView = (
  userId: string,
  operator: AdminUser,
): AdminUserStatusView => ({
  userId,
  operator: {
    adminUserId: operator.id,
    role: AdminRole.OPERATOR,
    isActive: operator.isActive,
    mustChangePassword: operator.mustChangePassword,
  },
});
