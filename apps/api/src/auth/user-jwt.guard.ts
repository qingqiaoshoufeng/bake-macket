import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';

import { type AppConfig } from '../config/env.schema.js';
import { User } from '../database/entities/user.entity.js';
import { JWT_USER_AUDIENCE } from './auth.constants.js';
import { type AuthenticatedUser, type UserJwtPayload } from './auth.types.js';

/**
 * Guards user-only endpoints.
 *
 * On success it attaches the decoded principal to `request.user` with type
 * {@link AuthenticatedUser}. On any failure it rejects the request with a
 * `401 Unauthorized` so callers cannot distinguish "no token" from
 * "wrong audience" — that prevents token-confusion probing.
 *
 * Cross-audience tokens (e.g. an admin JWT with `aud = 'mall-admin'`) are
 * rejected because the audience comparison happens before the principal is
 * attached; the same logic keeps tokens signed with `JWT_ADMIN_SECRET`
 * out of customer endpoints.
 */
@Injectable()
export class JwtUserGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const env = this.config.get('appEnv', { infer: true });
    let payload: UserJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<UserJwtPayload>(token, {
        secret: env.JWT_USER_SECRET,
        audience: JWT_USER_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (
      !payload ||
      payload.aud !== JWT_USER_AUDIENCE ||
      typeof payload.sub !== 'string' ||
      !/^[1-9]\d*$/.test(payload.sub) ||
      !Number.isSafeInteger(payload.tokenVersion) ||
      payload.tokenVersion < 1
    ) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    let user: User | null;
    try {
      user = await this.users.findOne({ where: { id: payload.sub } });
    } catch (cause) {
      throw new UnauthorizedException('Invalid or expired token', { cause });
    }
    if (
      !user ||
      !user.isActive ||
      user.mergedIntoUserId !== null ||
      user.tokenVersion !== payload.tokenVersion
    ) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const principal: AuthenticatedUser = {
      id: user.id,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
    };
    (request as Request & { user?: AuthenticatedUser }).user = principal;
    return true;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers['authorization'];
  if (!header) {
    return null;
  }
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = value.slice('bearer '.length).trim();
  return token.length > 0 ? token : null;
}
