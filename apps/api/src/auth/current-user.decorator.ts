import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  type AuthenticatedAdmin,
  type AuthenticatedUser,
} from './auth.types.js';

/**
 * Resolves the customer principal attached by {@link JwtUserGuard}. Throws
 * `500` if the guard did not run first — that signals a wiring bug at the
 * call site and should never be caught silently.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user?: AuthenticatedUser }).user;
    if (!user) {
      throw new InternalServerErrorException(
        'JwtUserGuard must run before @CurrentUser()',
      );
    }
    return user;
  },
);

/**
 * Resolves the back-office principal attached by {@link JwtAdminGuard}.
 * Mirrors {@link CurrentUser} but reads from `request.admin`.
 */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedAdmin => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const admin = (request as Request & { admin?: AuthenticatedAdmin }).admin;
    if (!admin) {
      throw new InternalServerErrorException(
        'JwtAdminGuard must run before @CurrentAdmin()',
      );
    }
    return admin;
  },
);
