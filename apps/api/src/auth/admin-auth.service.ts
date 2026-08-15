import {
  AdminRole,
  ApiErrorCode,
  type AdminLoginRequest,
  type AdminSessionView,
  type ChangeAdminPasswordRequest,
  type ChangeInitialOperatorPasswordRequest,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
} from '@bake-mall/contracts';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { type AppConfig } from '../config/env.schema.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';
import { User } from '../database/entities/user.entity.js';
import { normalizeOperatorPhone } from '../users/user-identity.service.js';
import { JWT_ADMIN_AUDIENCE } from './auth.constants.js';
import { type AuthenticatedUser, type AdminJwtPayload } from './auth.types.js';
import { validateAdminPassword } from './admin-password-policy.js';
import { AdminVerificationService } from './admin-verification.service.js';
import { isEligibleOperatorLinkedUser } from './operator-linked-user-eligibility.js';

export const ADMIN_BCRYPT_COST = 10;

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectRepository(AdminUser)
    private readonly admins: Repository<AdminUser>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly verification: AdminVerificationService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = this.config.get('appEnv', { infer: true });
    if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
      this.logger.warn(
        'ADMIN_EMAIL/ADMIN_PASSWORD not provided; admin seeding skipped.',
      );
      return;
    }
    const existing = await this.admins.findOne({
      where: { username: env.ADMIN_EMAIL },
    });
    if (existing) return;
    const passwordHash = await bcrypt.hash(
      env.ADMIN_PASSWORD,
      ADMIN_BCRYPT_COST,
    );
    await this.admins.save(
      this.admins.create({
        username: env.ADMIN_EMAIL,
        role: AdminRole.SUPER_ADMIN,
        linkedUserId: null,
        passwordHash,
        isActive: true,
        mustChangePassword: false,
        tokenVersion: 1,
      }),
    );
    this.logger.log(`Seeded initial admin user ${env.ADMIN_EMAIL}`);
  }

  async login(input: AdminLoginRequest): Promise<AdminSessionView> {
    return input.kind === 'SUPER_ADMIN'
      ? this.loginWithCredentials(input.email, input.password)
      : this.loginOperator(input.phone, input.password);
  }

  async loginWithCredentials(
    email: string,
    password: string,
  ): Promise<AdminSessionView> {
    const normalizedEmail = email.trim().toLowerCase();
    const verification = await this.verification.verifyPublicLogin({
      loginKind: 'SUPER_ADMIN',
      normalizedIdentifier: normalizedEmail,
      candidatePassword: password,
      now: new Date(),
      resolveAdmin: async (manager) => {
        const admin = await manager.getRepository(AdminUser).findOne({
          where: { username: normalizedEmail },
          lock: { mode: 'pessimistic_write' },
        });
        return admin?.role === AdminRole.SUPER_ADMIN && admin.isActive
          ? admin
          : null;
      },
    });
    return this.issueSession(verification.admin);
  }

  async loginOperator(
    phone: string,
    password: string,
  ): Promise<AdminSessionView> {
    const normalizedPhone = normalizeOperatorPhone(phone);
    const verification = await this.verification.verifyPublicLogin({
      loginKind: 'OPERATOR',
      normalizedIdentifier: normalizedPhone,
      candidatePassword: password,
      now: new Date(),
      resolveAdmin: async (manager) => {
        const admin = await manager.getRepository(AdminUser).findOne({
          where: { loginPhone: normalizedPhone },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !admin ||
          admin.role !== AdminRole.OPERATOR ||
          !admin.isActive ||
          !admin.linkedUserId
        ) {
          return null;
        }
        const user = await manager.getRepository(User).findOne({
          where: { id: admin.linkedUserId },
          lock: { mode: 'pessimistic_write' },
        });
        return isEligibleOperatorLinkedUser(user) ? admin : null;
      },
    });
    return this.issueSession(verification.admin);
  }

  async exchangeOperatorSession(
    principal: AuthenticatedUser,
  ): Promise<AdminSessionView> {
    const user = await this.users.findOne({ where: { id: principal.id } });
    if (!isEligibleOperatorLinkedUser(user)) {
      throw new ForbiddenException('Operator session unavailable');
    }
    const admin = await this.admins.findOne({
      where: { linkedUserId: user.id },
    });
    if (
      !admin ||
      !admin.isActive ||
      admin.role !== AdminRole.OPERATOR ||
      admin.linkedUserId !== user.id
    ) {
      throw new ForbiddenException('Operator session unavailable');
    }
    return this.issueSession(admin);
  }

  async changeInitialOperatorPassword(
    principal: import('./auth.types.js').AuthenticatedAdmin,
    input: ChangeInitialOperatorPasswordRequest,
  ): Promise<AdminSessionView> {
    if (
      principal.role !== AdminRole.OPERATOR ||
      !principal.mustChangePassword
    ) {
      throw new ForbiddenException({
        code: ApiErrorCode.ADMIN_PASSWORD_CHANGE_REQUIRED,
        message: 'Initial password change is not available',
      });
    }
    if (
      input.newPassword !== input.confirmPassword ||
      !validateAdminPassword(input.newPassword).ok
    ) {
      throw new BadRequestException({
        code: ApiErrorCode.ADMIN_PASSWORD_POLICY_VIOLATION,
        message: 'New password is invalid',
      });
    }
    const outcome = await this.dataSource.transaction(async (manager) => {
      const verification = await this.verification.verifyInTransaction(
        manager,
        {
          adminId: principal.id,
          candidatePassword: input.temporaryPassword,
          now: new Date(),
          context: { purpose: 'INITIAL_PASSWORD_CHANGE' },
        },
      );
      if (verification.status !== 'VERIFIED') {
        return { verification } as const;
      }
      const admin = verification.admin;
      if (
        admin.role !== AdminRole.OPERATOR ||
        !admin.isActive ||
        !admin.mustChangePassword
      ) {
        throw new ForbiddenException({
          code: ApiErrorCode.ADMIN_PASSWORD_CHANGE_REQUIRED,
          message: 'Initial password change is not available',
        });
      }
      admin.passwordHash = await bcrypt.hash(
        input.newPassword,
        ADMIN_BCRYPT_COST,
      );
      admin.mustChangePassword = false;
      admin.lastPasswordChangedAt = new Date();
      admin.tokenVersion += 1;
      admin.verifyFailedCount = 0;
      admin.verifyWindowStartedAt = null;
      const saved = await manager.getRepository(AdminUser).save(admin);
      await this.audit.record(
        {
          actor: { type: 'ADMIN', adminUserId: saved.id },
          targetEntity: 'admin_users',
          targetId: saved.id,
          action: 'ADMIN_INITIAL_PASSWORD_CHANGED',
          changeSummary: { role: saved.role, tokenVersion: saved.tokenVersion },
        },
        manager,
      );
      return { admin: saved } as const;
    });
    if ('verification' in outcome && outcome.verification) {
      this.verification.assertVerified(outcome.verification);
      throw new Error('unreachable');
    }
    return this.issueSession(outcome.admin);
  }

  async changePassword(
    principal: import('./auth.types.js').AuthenticatedAdmin,
    input: ChangeAdminPasswordRequest,
  ): Promise<AdminSessionView> {
    if (principal.mustChangePassword) {
      throw new ForbiddenException({
        code: ApiErrorCode.ADMIN_PASSWORD_CHANGE_REQUIRED,
        message: 'Initial password change is required',
      });
    }
    if (
      input.newPassword !== input.confirmPassword ||
      !validateAdminPassword(input.newPassword).ok
    ) {
      throw new BadRequestException({
        code: ApiErrorCode.ADMIN_PASSWORD_POLICY_VIOLATION,
        message: 'New password is invalid',
      });
    }
    const outcome = await this.dataSource.transaction(async (manager) => {
      const verification = await this.verification.verifyInTransaction(
        manager,
        {
          adminId: principal.id,
          candidatePassword: input.currentPassword,
          now: new Date(),
          context: { purpose: 'PASSWORD_CHANGE' },
        },
      );
      if (verification.status !== 'VERIFIED') {
        return { verification } as const;
      }
      const admin = verification.admin;
      if (!admin.isActive || admin.mustChangePassword) {
        throw new ForbiddenException({
          code: ApiErrorCode.ADMIN_PASSWORD_CHANGE_REQUIRED,
          message: 'Full admin session required',
        });
      }
      admin.passwordHash = await bcrypt.hash(
        input.newPassword,
        ADMIN_BCRYPT_COST,
      );
      admin.lastPasswordChangedAt = new Date();
      admin.tokenVersion += 1;
      admin.verifyFailedCount = 0;
      admin.verifyWindowStartedAt = null;
      const saved = await manager.getRepository(AdminUser).save(admin);
      await this.audit.record(
        {
          actor: { type: 'ADMIN', adminUserId: saved.id },
          targetEntity: 'admin_users',
          targetId: saved.id,
          action: 'ADMIN_PASSWORD_CHANGED',
          changeSummary: { role: saved.role, tokenVersion: saved.tokenVersion },
        },
        manager,
      );
      return { admin: saved } as const;
    });
    if ('verification' in outcome && outcome.verification) {
      this.verification.assertVerified(outcome.verification);
      throw new Error('unreachable');
    }
    return this.issueSession(outcome.admin);
  }

  issueSession(admin: AdminUser): AdminSessionView {
    const env = this.config.get('appEnv', { infer: true });
    const payload: AdminJwtPayload = {
      sub: admin.id,
      aud: JWT_ADMIN_AUDIENCE,
      role: admin.role,
      tokenVersion: admin.tokenVersion,
      linkedUserId: admin.linkedUserId,
      mustChangePassword: admin.mustChangePassword,
    };
    const accessToken = this.jwt.sign(payload, {
      secret: env.JWT_ADMIN_SECRET,
      expiresIn: env.JWT_EXPIRES_IN_SECONDS,
    });
    const expiresAt = new Date(
      Date.now() + env.JWT_EXPIRES_IN_SECONDS * 1000,
    ).toISOString();
    if (admin.role === AdminRole.OPERATOR && admin.mustChangePassword) {
      return {
        accessToken,
        expiresAt,
        role: AdminRole.OPERATOR,
        permissions: [],
        mustChangePassword: true,
      };
    }
    if (admin.role === AdminRole.OPERATOR) {
      return {
        accessToken,
        expiresAt,
        role: AdminRole.OPERATOR,
        permissions: OPERATOR_PERMISSIONS,
        mustChangePassword: false,
      };
    }
    return {
      accessToken,
      expiresAt,
      role: AdminRole.SUPER_ADMIN,
      permissions: SUPER_ADMIN_PERMISSIONS,
      mustChangePassword: false,
    };
  }
}
