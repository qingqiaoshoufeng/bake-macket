import { ApiErrorCode } from '@bake-mall/contracts';
import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';
import { createHmac } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { type AppConfig } from '../config/env.schema.js';
import { AdminLoginVerificationBucket } from '../database/entities/admin-login-verification-bucket.entity.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';

const VERIFICATION_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILED_VERIFICATIONS = 5;
const PUBLIC_LOGIN_BUCKET_DOMAIN = 'bake-mall:admin-login-verification:v1';
const DUMMY_PASSWORD_HASH =
  '$2b$10$pdHE.8Gqfk.OL5564470E.Nin3GP8ZlAusDeNKNzYg3T5703Xj8l2';

export const ADMIN_LOGIN_BUCKET_COUNT = 1024;

export type AdminVerificationPurpose =
  'INITIAL_PASSWORD_CHANGE' | 'HIGH_RISK_ACTION' | 'PASSWORD_CHANGE';

export type AdminLoginKind = 'SUPER_ADMIN' | 'OPERATOR';

type VerificationContext = { purpose: AdminVerificationPurpose };

type AdminVerificationInput = {
  adminId: string;
  candidatePassword: string;
  now: Date;
  context: VerificationContext;
};

type PublicLoginVerificationInput = {
  loginKind: AdminLoginKind;
  normalizedIdentifier: string;
  candidatePassword: string;
  now: Date;
  resolveAdmin: (manager: EntityManager) => Promise<AdminUser | null>;
};

export type AdminVerificationOutcome =
  | { status: 'VERIFIED'; admin: AdminUser }
  | { status: 'FAILED'; count: number; windowStartedAt: Date | null }
  | { status: 'RATE_LIMITED'; count: number; windowStartedAt: Date | null };

export const calculateAdminLoginBucketId = (
  secret: string,
  loginKind: AdminLoginKind,
  normalizedIdentifier: string,
): number => {
  const digest = createHmac('sha256', secret)
    .update(
      `${PUBLIC_LOGIN_BUCKET_DOMAIN}\0${loginKind}\0${normalizedIdentifier}`,
    )
    .digest();
  return digest.readUInt32BE(0) % ADMIN_LOGIN_BUCKET_COUNT;
};

const isWindowActive = (
  windowStartedAt: Date | null,
  now: Date,
): windowStartedAt is Date =>
  windowStartedAt !== null &&
  now.getTime() - windowStartedAt.getTime() < VERIFICATION_WINDOW_MS;

const databaseUtcTime = async (manager: EntityManager): Promise<Date> => {
  const result = (await manager.query(
    'SELECT UTC_TIMESTAMP(6) AS `database_now`',
  )) as unknown;
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('Database UTC time query returned an invalid result');
  }
  const row = result[0];
  if (typeof row !== 'object' || row === null || !('database_now' in row)) {
    throw new Error('Database UTC time query returned an invalid row');
  }
  const rawTime = (row as { database_now: unknown }).database_now;
  const parsed =
    rawTime instanceof Date
      ? new Date(rawTime.getTime())
      : typeof rawTime === 'string'
        ? new Date(`${rawTime.replace(' ', 'T')}Z`)
        : new Date(Number.NaN);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('Database UTC time query returned an invalid timestamp');
  }
  return parsed;
};

@Injectable()
export class AdminVerificationService {
  private readonly adminSecret: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.adminSecret = config.get('appEnv', {
      infer: true,
    }).JWT_ADMIN_SECRET;
  }

  async verifyPublicLogin(
    input: PublicLoginVerificationInput,
  ): Promise<Extract<AdminVerificationOutcome, { status: 'VERIFIED' }>> {
    const outcome = await this.withDeadlockRetry(() =>
      this.dataSource.transaction(async (manager) => {
        const buckets = manager.getRepository(AdminLoginVerificationBucket);
        const bucketId = calculateAdminLoginBucketId(
          this.adminSecret,
          input.loginKind,
          input.normalizedIdentifier,
        );
        const bucket = await buckets.findOne({
          where: { bucketId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!bucket) {
          throw new Error('Admin login verification bucket unavailable');
        }
        const now = await databaseUtcTime(manager);

        const bucketWindowActive = isWindowActive(bucket.windowStartedAt, now);
        if (
          bucketWindowActive &&
          bucket.failedCount >= MAX_FAILED_VERIFICATIONS
        ) {
          return {
            status: 'RATE_LIMITED',
            count: bucket.failedCount,
            windowStartedAt: bucket.windowStartedAt,
          } satisfies AdminVerificationOutcome;
        }

        const admin = await input.resolveAdmin(manager);
        if (admin) {
          const adminWindowActive = isWindowActive(
            admin.verifyWindowStartedAt,
            now,
          );
          const adminWindowLimited =
            adminWindowActive &&
            admin.verifyFailedCount >= MAX_FAILED_VERIFICATIONS;
          if (adminWindowLimited) {
            await bcrypt.compare(input.candidatePassword, DUMMY_PASSWORD_HASH);
          } else {
            const matches = await bcrypt.compare(
              input.candidatePassword,
              admin.passwordHash,
            );
            if (matches) {
              admin.verifyFailedCount = 0;
              admin.verifyWindowStartedAt = null;
              await manager.getRepository(AdminUser).save(admin);
              return {
                status: 'VERIFIED',
                admin,
              } satisfies AdminVerificationOutcome;
            }

            admin.verifyFailedCount = adminWindowActive
              ? admin.verifyFailedCount + 1
              : 1;
            admin.verifyWindowStartedAt = adminWindowActive
              ? admin.verifyWindowStartedAt
              : now;
            await manager.getRepository(AdminUser).save(admin);
          }
        } else {
          await bcrypt.compare(input.candidatePassword, DUMMY_PASSWORD_HASH);
        }

        bucket.failedCount = bucketWindowActive ? bucket.failedCount + 1 : 1;
        bucket.windowStartedAt = bucketWindowActive
          ? bucket.windowStartedAt
          : now;
        await buckets.save(bucket);
        return {
          status: 'FAILED',
          count: bucket.failedCount,
          windowStartedAt: bucket.windowStartedAt,
        } satisfies AdminVerificationOutcome;
      }),
    );
    return this.assertVerified(outcome);
  }

  async verifyPassword(
    input: AdminVerificationInput,
  ): Promise<Extract<AdminVerificationOutcome, { status: 'VERIFIED' }>> {
    this.assertNonPublicPurpose(input.context.purpose);
    const outcome = await this.dataSource.transaction((manager) =>
      this.verifyInTransaction(manager, input),
    );
    return this.assertVerified(outcome);
  }

  assertVerified(
    outcome: AdminVerificationOutcome,
  ): Extract<AdminVerificationOutcome, { status: 'VERIFIED' }> {
    if (outcome.status === 'FAILED') {
      throw new UnauthorizedException({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
        message: 'Admin verification failed',
      });
    }
    if (outcome.status === 'RATE_LIMITED') {
      throw new HttpException(
        {
          code: ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
          message: 'Admin verification rate limited',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return outcome;
  }

  async verifyInTransaction(
    manager: EntityManager,
    input: AdminVerificationInput,
  ): Promise<AdminVerificationOutcome> {
    this.assertNonPublicPurpose(input.context.purpose);
    const admins = manager.getRepository(AdminUser);
    const admin = await admins.findOne({
      where: { id: input.adminId },
      lock: { mode: 'pessimistic_write' },
    });

    const now = await databaseUtcTime(manager);

    if (!admin) {
      await bcrypt.compare(input.candidatePassword, DUMMY_PASSWORD_HASH);
      const outcome: AdminVerificationOutcome = {
        status: 'FAILED',
        count: 0,
        windowStartedAt: null,
      };
      await this.recordOutcome(manager, input, outcome, null);
      return outcome;
    }

    const activeWindow = isWindowActive(admin.verifyWindowStartedAt, now);
    if (activeWindow && admin.verifyFailedCount >= MAX_FAILED_VERIFICATIONS) {
      const outcome: AdminVerificationOutcome = {
        status: 'RATE_LIMITED',
        count: admin.verifyFailedCount,
        windowStartedAt: admin.verifyWindowStartedAt,
      };
      await this.recordOutcome(manager, input, outcome, admin.id);
      return outcome;
    }

    const matches = await bcrypt.compare(
      input.candidatePassword,
      admin.passwordHash,
    );
    if (matches) {
      admin.verifyFailedCount = 0;
      admin.verifyWindowStartedAt = null;
      await admins.save(admin);
      const outcome: AdminVerificationOutcome = {
        status: 'VERIFIED',
        admin,
      };
      await this.recordOutcome(manager, input, outcome, admin.id);
      return outcome;
    }

    admin.verifyFailedCount = activeWindow ? admin.verifyFailedCount + 1 : 1;
    admin.verifyWindowStartedAt = activeWindow
      ? admin.verifyWindowStartedAt
      : now;
    await admins.save(admin);
    const outcome: AdminVerificationOutcome = {
      status: 'FAILED',
      count: admin.verifyFailedCount,
      windowStartedAt: admin.verifyWindowStartedAt,
    };
    await this.recordOutcome(manager, input, outcome, admin.id);
    return outcome;
  }

  private assertNonPublicPurpose(purpose: unknown): void {
    if (purpose === 'LOGIN') {
      throw new Error('Public login must use verifyPublicLogin');
    }
  }

  private async withDeadlockRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
        if (code !== 'ER_LOCK_DEADLOCK' || attempt >= 8) throw error;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, 5 * 2 ** attempt),
        );
      }
    }
  }

  private async recordOutcome(
    manager: EntityManager,
    input: { context: VerificationContext },
    outcome: AdminVerificationOutcome,
    adminId: string | null,
  ): Promise<void> {
    const count = outcome.status === 'VERIFIED' ? 0 : outcome.count;
    const windowStartedAt =
      outcome.status === 'VERIFIED' ? null : outcome.windowStartedAt;
    await this.audit.record(
      {
        actor: adminId
          ? { type: 'ADMIN', adminUserId: adminId }
          : { type: 'SYSTEM' },
        targetEntity: adminId ? 'admin_users' : 'security',
        targetId: adminId ?? 'admin-verification',
        action: 'ADMIN_PASSWORD_VERIFICATION',
        changeSummary: {
          count,
          purpose: input.context.purpose,
          result: outcome.status,
          windowStartedAt,
        },
      },
      manager,
    );
  }
}
