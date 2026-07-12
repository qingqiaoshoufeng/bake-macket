import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { type AppConfig } from '../config/env.schema.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';
import { User } from '../database/entities/user.entity.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AuthController } from './auth.controller.js';
import { UserAuthService } from './user-auth.service.js';

/**
 * Auth module wires two isolated JWT signing strategies under a single
 * `JwtModule` instance.
 *
 * Both strategies share the same private key infrastructure but use distinct
 * secrets and audiences — `JwtModule.registerAsync` is configured with the
 * customer secret + audience as the defaults, and the admin service explicitly
 * passes its own secret + audience when signing, so a stolen user token can
 * never be replayed against an admin endpoint.
 *
 * The `User` and `AdminUser` repositories are injected into the services so
 * user creation and admin seeding work against the real TypeORM data source
 * (see `OnModuleInit` in {@link AdminAuthService}).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, AdminUser]),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const env = config.get('appEnv', { infer: true });
        return {
          secret: env.JWT_USER_SECRET,
          // Audience is encoded in the payload by the signing services, not
          // in the default `signOptions` (jsonwebtoken rejects both at once).
          signOptions: {
            expiresIn: env.JWT_EXPIRES_IN_SECONDS,
          },
          verifyOptions: {
            audience: 'mall-user',
          },
        };
      },
    }),
  ],
  controllers: [AuthController, AdminAuthController],
  providers: [UserAuthService, AdminAuthService],
  exports: [UserAuthService, AdminAuthService, JwtModule],
})
export class AuthModule {}
