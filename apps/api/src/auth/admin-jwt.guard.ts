import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { type AppConfig } from '../config/env.schema.js';
import { JWT_ADMIN_AUDIENCE, JWT_USER_AUDIENCE } from './auth.constants.js';
import { type AdminJwtPayload, type AuthenticatedAdmin } from './auth.types.js';

/**
 * Guards back-office endpoints.
 *
 * Mirrors {@link JwtUserGuard} but verifies against `JWT_ADMIN_SECRET` and
 * the `mall-admin` audience. Tokens signed for the user audience are rejected
 * with `401` so admin endpoints never accept user credentials.
 *
 * The decoded principal lands on `request.admin` (distinct from
 * `request.user`) so handlers can mount both guards at different layers
 * without overwriting the same property.
 */
@Injectable()
export class JwtAdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const env = this.config.get('appEnv', { infer: true });
    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        secret: env.JWT_ADMIN_SECRET,
        audience: JWT_ADMIN_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (
      !payload ||
      payload.aud !== JWT_ADMIN_AUDIENCE ||
      payload.aud === (JWT_USER_AUDIENCE as string)
    ) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const principal: AuthenticatedAdmin = {
      id: payload.sub,
      email: payload.email,
    };
    (request as Request & { admin?: AuthenticatedAdmin }).admin = principal;
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
