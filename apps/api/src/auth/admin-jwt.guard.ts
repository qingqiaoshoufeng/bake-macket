import {
  AdminRole,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
} from '@bake-mall/contracts';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DataSource } from 'typeorm';

import { type AppConfig } from '../config/env.schema.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';
import { User } from '../database/entities/user.entity.js';
import { JWT_ADMIN_AUDIENCE } from './auth.constants.js';
import { type AdminJwtPayload, type AuthenticatedAdmin } from './auth.types.js';
import { isEligibleOperatorLinkedUser } from './operator-linked-user-eligibility.js';

const BIGINT_ID_PATTERN = /^(?:[1-9][0-9]*)$/u;
const invalidToken = (cause?: unknown) =>
  new UnauthorizedException('Invalid or expired token', { cause });

@Injectable()
export class JwtAdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const env = this.config.get('appEnv', { infer: true });
    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        secret: env.JWT_ADMIN_SECRET,
        audience: JWT_ADMIN_AUDIENCE,
      });
    } catch (error) {
      throw invalidToken(error);
    }
    if (
      payload.aud !== JWT_ADMIN_AUDIENCE ||
      typeof payload.sub !== 'string' ||
      !BIGINT_ID_PATTERN.test(payload.sub) ||
      !Number.isSafeInteger(payload.tokenVersion) ||
      payload.tokenVersion < 1 ||
      !Object.values(AdminRole).includes(payload.role) ||
      typeof payload.mustChangePassword !== 'boolean'
    ) {
      throw invalidToken();
    }

    try {
      const admin = await this.dataSource
        .getRepository(AdminUser)
        .findOne({ where: { id: payload.sub } });
      if (
        !admin ||
        !admin.isActive ||
        admin.tokenVersion !== payload.tokenVersion ||
        admin.role !== payload.role ||
        admin.mustChangePassword !== payload.mustChangePassword ||
        admin.linkedUserId !== payload.linkedUserId
      ) {
        throw invalidToken();
      }
      if (admin.role === AdminRole.OPERATOR) {
        if (!admin.linkedUserId) throw invalidToken();
        const linkedUser = await this.dataSource.getRepository(User).findOne({
          where: { id: admin.linkedUserId },
        });
        if (!isEligibleOperatorLinkedUser(linkedUser)) throw invalidToken();
      }
      const principal: AuthenticatedAdmin = {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        linkedUserId: admin.linkedUserId,
        mustChangePassword: admin.mustChangePassword,
        permissions:
          admin.role === AdminRole.OPERATOR && admin.mustChangePassword
            ? []
            : admin.role === AdminRole.OPERATOR
              ? OPERATOR_PERMISSIONS
              : SUPER_ADMIN_PERMISSIONS,
      };
      (request as Request & { admin?: AuthenticatedAdmin }).admin = principal;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw invalidToken(error);
    }
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  const token = value.slice('bearer '.length).trim();
  return token.length > 0 ? token : null;
}
