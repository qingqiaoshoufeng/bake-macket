import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ApiErrorCode } from '@bake-mall/contracts';

import { type AppConfig } from '../config/env.schema.js';
import { User } from '../database/entities/user.entity.js';
import { UserIdentityMergeService } from '../users/user-identity-merge.service.js';
import {
  DEVELOPMENT_VERIFICATION_CODE,
  JWT_USER_AUDIENCE,
} from './auth.constants.js';
import { type AuthSession, type UserJwtPayload } from './auth.types.js';

/**
 * Customer authentication service.
 *
 * Responsibilities:
 * - Issue development verification codes in non-production environments
 *   (the production mock will be replaced by WeChat OAuth / real SMS in a
 *   later task).
 * - Exchange a verified phone + code for a long-lived user JWT.
 * - Bind a verified phone to an already-authenticated customer (requires
 *   `JwtUserGuard` upstream; the guard ensures only authenticated users
 *   reach the service through `bindPhone`).
 *
 * Tokens always carry `aud = 'mall-user'` so {@link JwtUserGuard} can reject
 * cross-audience tokens (see `auth-isolation.e2e-spec`).
 */
@Injectable()
export class UserAuthService {
  private readonly logger = new Logger(UserAuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly identityMerge: UserIdentityMergeService,
  ) {}

  /**
   * Mock the SMS gateway by logging the code. Real SMS will plug in here in
   * a later task; the public surface stays the same.
   */
  async sendDevelopmentCode(phone: string): Promise<void> {
    this.assertNotProduction();
    this.logger.log(
      `[DEV] Verification code for ${phone} is ${DEVELOPMENT_VERIFICATION_CODE}`,
    );
  }

  /**
   * Verify the supplied phone/code pair against the fixed development code,
   * resolve the user record (creating it on first use), and return a signed
   * user JWT. Production environments reject the dev code outright.
   */
  async loginWithDevelopmentCode(
    phone: string,
    code: string,
  ): Promise<AuthSession> {
    this.assertNotProduction();
    this.assertCodeMatches(code);
    const user = await this.findOrCreateByPhone(phone);
    return this.issueSession(user);
  }

  /**
   * Bind a phone number to an already-authenticated user after re-verifying
   * the development code. The pre-condition is enforced by
   * {@link JwtUserGuard} so this method trusts the upstream identity.
   */
  async bindPhone(
    authenticatedUser: { id: string; phone: string | null },
    phone: string,
    code: string,
  ): Promise<AuthSession> {
    this.assertNotProduction();
    this.assertCodeMatches(code);
    const merged = await this.identityMerge.mergeVerifiedPhone({
      authenticatedUserId: authenticatedUser.id,
      normalizedPhone: phone,
    });
    return this.issueSession(merged.user);
  }

  /**
   * Reject the call when the environment is production. The dev code must
   * never be accepted in production regardless of the caller.
   */
  private assertNotProduction(): void {
    const { NODE_ENV } = this.config.get('appEnv', { infer: true });
    if (NODE_ENV === 'production') {
      throw new UnauthorizedException(
        'Development verification code is disabled in production',
      );
    }
  }

  private assertCodeMatches(code: string): void {
    if (code !== DEVELOPMENT_VERIFICATION_CODE) {
      throw new UnauthorizedException('Invalid verification code');
    }
  }

  private async findOrCreateByPhone(phone: string): Promise<User> {
    const existing = await this.users.findOne({ where: { phone } });
    if (existing?.phoneVerified) return existing;
    if (existing) {
      const merged = await this.identityMerge.mergeVerifiedPhone({
        authenticatedUserId: existing.id,
        normalizedPhone: phone,
      });
      return merged.user;
    }
    const created = await this.users.save(
      this.users.create({
        nickname: null,
        avatarUrl: null,
        wechatOpenid: null,
        wechatUnionid: null,
      }),
    );
    const merged = await this.identityMerge.mergeVerifiedPhone({
      authenticatedUserId: created.id,
      normalizedPhone: phone,
    });
    return merged.user;
  }

  issueSession(user: User): AuthSession {
    const env = this.config.get('appEnv', { infer: true });
    const payload: UserJwtPayload = {
      sub: user.id,
      aud: JWT_USER_AUDIENCE,
      phone: user.phone,
      tokenVersion: user.tokenVersion,
    };
    // The payload already carries `aud`; jsonwebtoken rejects passing
    // `audience` at sign time when the payload has the claim.
    const accessToken = this.jwt.sign(payload, {
      secret: env.JWT_USER_SECRET,
      expiresIn: env.JWT_EXPIRES_IN_SECONDS,
    });
    const expiresAt = new Date(
      Date.now() + env.JWT_EXPIRES_IN_SECONDS * 1000,
    ).toISOString();
    return { accessToken, expiresAt };
  }
}

/**
 * Pre-condition for the order-create flow: the user must have a verified
 * phone. Returns the verified user otherwise. Throws
 * {@link ForbiddenException} with {@link ApiErrorCode.PHONE_REQUIRED} when the
 * phone is not bound.
 *
 * Exposed as a free function so order-creation code (Task 5+) can call it
 * without taking a dependency on {@link UserAuthService}; the unit test in
 * `auth.service.spec.ts` pins the contract.
 */
export function requireVerifiedPhone(user: {
  id: string;
  phone: string | null;
  phoneVerified: boolean;
}): { id: string; phone: string; phoneVerified: true } {
  if (!user.phone || user.phoneVerified !== true) {
    throw new ForbiddenException({
      code: ApiErrorCode.PHONE_REQUIRED,
      message: 'A verified phone number is required before placing an order.',
    });
  }
  return { id: user.id, phone: user.phone, phoneVerified: true };
}
