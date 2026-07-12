import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import bcrypt from 'bcrypt';

import { type AppConfig } from '../config/env.schema.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';
import { JWT_ADMIN_AUDIENCE } from './auth.constants.js';
import { type AdminJwtPayload, type AuthSession } from './auth.types.js';

/**
 * Cost factor used when hashing the bootstrap admin password. Kept low
 * because provisioning happens once at startup and we want to avoid tying
 * container boot to a long CPU-bound task.
 */
const ADMIN_BCRYPT_COST = 10;

/**
 * Back-office authentication service.
 *
 * - On bootstrap, ensures the single admin account exists, sourced from the
 *   `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars. The password is bcrypt-hashed
 *   before persistence; the raw value is never written to disk or logs.
 * - Issues admin JWTs signed with `JWT_ADMIN_SECRET` and audience
 *   `'mall-admin'` so {@link JwtAdminGuard} can reject cross-audience tokens.
 */
@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectRepository(AdminUser)
    private readonly admins: Repository<AdminUser>,
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
    if (existing) {
      return;
    }
    const passwordHash = await bcrypt.hash(
      env.ADMIN_PASSWORD,
      ADMIN_BCRYPT_COST,
    );
    const admin = this.admins.create({
      username: env.ADMIN_EMAIL,
      passwordHash,
      isActive: true,
    });
    await this.admins.save(admin);
    this.logger.log(`Seeded initial admin user ${env.ADMIN_EMAIL}`);
  }

  /**
   * Verify the supplied credentials against the bcrypt-hashed admin record
   * and return a signed admin JWT.
   */
  async loginWithCredentials(
    email: string,
    password: string,
  ): Promise<AuthSession> {
    const admin = await this.admins.findOne({ where: { username: email } });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const matches = await bcrypt.compare(password, admin.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueSession(admin.id, email);
  }

  private issueSession(adminId: string, email: string): AuthSession {
    const env = this.config.get('appEnv', { infer: true });
    const payload: AdminJwtPayload = {
      sub: adminId,
      aud: JWT_ADMIN_AUDIENCE,
      email,
    };
    // The payload already carries `aud`; jsonwebtoken rejects passing
    // `audience` at sign time when the payload has the claim.
    const accessToken = this.jwt.sign(payload, {
      secret: env.JWT_ADMIN_SECRET,
      expiresIn: env.JWT_EXPIRES_IN_SECONDS,
    });
    const expiresAt = new Date(
      Date.now() + env.JWT_EXPIRES_IN_SECONDS * 1000,
    ).toISOString();
    return { accessToken, expiresAt };
  }
}
