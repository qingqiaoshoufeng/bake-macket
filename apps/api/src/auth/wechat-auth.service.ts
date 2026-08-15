import { createHash, randomUUID } from 'node:crypto';

import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import {
  ApiErrorCode,
  type CustomerAuthSessionView,
  type UserProfileView,
} from '@bake-mall/contracts';

import {
  WechatCredentialKind,
  WechatCredentialStatus,
  WechatCredentialUse,
} from '../database/entities/wechat-credential-use.entity.js';
import { User } from '../database/entities/user.entity.js';
import {
  UserIdentityMergeRejectedError,
  UserIdentityMergeService,
} from '../users/user-identity-merge.service.js';
import { UserIdentityService } from '../users/user-identity.service.js';
import { type AuthenticatedUser } from './auth.types.js';
import {
  WechatAuthAdapter,
  WechatAuthAdapterError,
  type WechatLoginIdentity,
} from './wechat-auth.adapter.js';
import { UserAuthService } from './user-auth.service.js';

export const WECHAT_CREDENTIAL_TTL_MS = 10 * 60 * 1000;

type LoginClaimSnapshot = Readonly<{
  version: 1;
  kind: 'CLAIM';
  claimId: string;
}>;

type PhoneClaimSnapshot = Readonly<{
  version: 2;
  kind: 'CLAIM';
  claimId: string;
  principal: Readonly<{ sourceUserId: string }>;
}>;

type ClaimSnapshot = LoginClaimSnapshot | PhoneClaimSnapshot;

type LoginCompletedSnapshot = Readonly<{
  version: 1;
  kind: 'COMPLETED';
  resource: Readonly<{ userId: string }>;
  session: Readonly<{ audience: 'mall-user' }>;
}>;

type PhoneCompletedSnapshot = Readonly<{
  version: 2;
  kind: 'COMPLETED';
  principal: Readonly<{ sourceUserId: string; canonicalUserId: string }>;
  resource: Readonly<{ userId: string }>;
  session: Readonly<{ audience: 'mall-user' }>;
}>;

type CompletedSnapshot = LoginCompletedSnapshot | PhoneCompletedSnapshot;

type DeterministicFailureCode =
  | ApiErrorCode.WECHAT_AUTH_FAILED
  | ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE
  | ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW
  | ApiErrorCode.WECHAT_IDENTITY_CONFLICT
  | ApiErrorCode.ADMIN_USER_CONFLICT;

type LoginFailedSnapshot = Readonly<{
  version: 1;
  kind: 'FAILED';
  failureCode: DeterministicFailureCode;
}>;

type PhoneFailedSnapshot = Readonly<{
  version: 2;
  kind: 'FAILED';
  principal: Readonly<{ sourceUserId: string }>;
  failureCode: DeterministicFailureCode;
}>;

type FailedSnapshot = LoginFailedSnapshot | PhoneFailedSnapshot;

type CredentialSnapshot = ClaimSnapshot | CompletedSnapshot | FailedSnapshot;

type ClaimAcquisition =
  | Readonly<{ state: 'OWNER'; claimId: string }>
  | Readonly<{
      state: 'COMPLETED';
      resourceUserId: string;
      snapshot: CompletedSnapshot;
    }>;

export const hashWechatCredential = (credential: string): string =>
  createHash('sha256').update(credential, 'utf8').digest('hex');

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

function asSnapshot(
  value: Record<string, unknown> | null,
): CredentialSnapshot | null {
  if (typeof value?.kind !== 'string') return null;
  if (value.kind === 'CLAIM' && typeof value.claimId === 'string') {
    if (value.version === 1) return value as LoginClaimSnapshot;
    if (
      value.version === 2 &&
      typeof value.principal === 'object' &&
      value.principal !== null &&
      typeof (value.principal as Record<string, unknown>).sourceUserId ===
        'string'
    ) {
      return value as PhoneClaimSnapshot;
    }
  }
  if (
    (value.version === 1 || value.version === 2) &&
    value.kind === 'COMPLETED' &&
    typeof value.resource === 'object' &&
    value.resource !== null &&
    typeof (value.resource as Record<string, unknown>).userId === 'string' &&
    typeof value.session === 'object' &&
    value.session !== null &&
    (value.session as Record<string, unknown>).audience === 'mall-user'
  ) {
    if (value.version === 1) return value as LoginCompletedSnapshot;
    if (
      typeof value.principal === 'object' &&
      value.principal !== null &&
      typeof (value.principal as Record<string, unknown>).sourceUserId ===
        'string' &&
      typeof (value.principal as Record<string, unknown>).canonicalUserId ===
        'string'
    ) {
      return value as PhoneCompletedSnapshot;
    }
  }
  if (
    value.kind === 'FAILED' &&
    [
      ApiErrorCode.WECHAT_AUTH_FAILED,
      ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE,
      ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
      ApiErrorCode.WECHAT_IDENTITY_CONFLICT,
      ApiErrorCode.ADMIN_USER_CONFLICT,
    ].includes(value.failureCode as ApiErrorCode)
  ) {
    if (value.version === 1) return value as LoginFailedSnapshot;
    if (
      value.version === 2 &&
      typeof value.principal === 'object' &&
      value.principal !== null &&
      typeof (value.principal as Record<string, unknown>).sourceUserId ===
        'string'
    ) {
      return value as PhoneFailedSnapshot;
    }
  }
  return null;
}

function processingConflict(): ConflictException {
  return new ConflictException({
    code: ApiErrorCode.WECHAT_CREDENTIAL_IN_PROGRESS,
    message: 'WeChat credential is already being processed.',
  });
}

function safeFailure(code: DeterministicFailureCode): HttpException {
  if (code === ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE) {
    return new ServiceUnavailableException({
      code,
      message: 'WeChat authentication is temporarily unavailable.',
    });
  }
  if (code === ApiErrorCode.WECHAT_AUTH_FAILED) {
    return new UnauthorizedException({
      code,
      message: 'WeChat credential is invalid or expired.',
    });
  }
  return new ConflictException({
    code,
    message: 'User identity merge requires manual review.',
  });
}

function deterministicMergeFailureCode(
  error: unknown,
): DeterministicFailureCode | null {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  const code =
    typeof response === 'object' && response !== null && 'code' in response
      ? (response as { code?: unknown }).code
      : undefined;
  return [
    ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
    ApiErrorCode.WECHAT_IDENTITY_CONFLICT,
    ApiErrorCode.ADMIN_USER_CONFLICT,
  ].includes(code as ApiErrorCode)
    ? (code as DeterministicFailureCode)
    : null;
}

function completedSnapshot(userId: string): LoginCompletedSnapshot {
  return {
    version: 1,
    kind: 'COMPLETED',
    resource: { userId },
    session: { audience: 'mall-user' },
  };
}

function completedPhoneSnapshot(
  sourceUserId: string,
  canonicalUserId: string,
): PhoneCompletedSnapshot {
  return {
    version: 2,
    kind: 'COMPLETED',
    principal: { sourceUserId, canonicalUserId },
    resource: { userId: canonicalUserId },
    session: { audience: 'mall-user' },
  };
}

function replayConflict(): ConflictException {
  return new ConflictException({
    code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
    message: 'WeChat credential has already been used.',
  });
}

function mapProfile(user: User): UserProfileView {
  return {
    id: user.id,
    nickname: user.nickname ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
    phone: maskPhone(user.phone) ?? undefined,
    phoneVerified: user.phoneVerified,
    orderContactPhone: user.orderContactPhone
      ? {
          configured: true,
          maskedPhone: maskPhone(user.orderContactPhone) as string,
          version: user.orderContactPhoneVersion,
        }
      : {
          configured: false,
          maskedPhone: null,
          version: user.orderContactPhoneVersion,
        },
  };
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length < 7) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

@Injectable()
export class WechatAuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly adapter: WechatAuthAdapter,
    private readonly identityMerge: UserIdentityMergeService,
    private readonly identities: UserIdentityService,
    private readonly userAuth: UserAuthService,
  ) {}

  async loginWithWechatCode(
    code: string,
    now = new Date(),
  ): Promise<CustomerAuthSessionView> {
    const credentialHash = hashWechatCredential(code);
    const claim = await this.acquireClaim(
      WechatCredentialKind.LOGIN,
      credentialHash,
      now,
    );
    if (claim.state === 'COMPLETED') {
      return this.sessionForResource(claim.resourceUserId);
    }

    try {
      const identity = await this.adapter.exchangeLoginCode(code);
      const user = await this.resolveWechatUser(identity);
      await this.completeClaim(credentialHash, claim.claimId, user.id);
      return this.buildCustomerSession(user);
    } catch (error) {
      if (error instanceof WechatAuthAdapterError) {
        await this.failClaim(credentialHash, claim.claimId, error.code);
        throw safeFailure(error.code);
      }
      await this.releaseClaimOnInternalFailure(credentialHash, claim.claimId);
      throw error;
    }
  }

  async bindWechatPhone(
    currentUser: AuthenticatedUser,
    code: string,
    now = new Date(),
  ): Promise<CustomerAuthSessionView> {
    const credentialHash = hashWechatCredential(code);
    const claim = await this.acquireClaim(
      WechatCredentialKind.PHONE,
      credentialHash,
      now,
      currentUser.id,
    );
    if (claim.state === 'COMPLETED') {
      if (
        claim.snapshot.version !== 2 ||
        ![
          claim.snapshot.principal.sourceUserId,
          claim.snapshot.principal.canonicalUserId,
        ].includes(currentUser.id)
      ) {
        throw replayConflict();
      }
      return this.sessionForResource(claim.resourceUserId);
    }

    try {
      const { phoneNumber } = await this.adapter.exchangePhoneCredential(code);
      const merged = await this.identityMerge.withPhoneLock(
        phoneNumber,
        async ({ manager, mergeVerifiedPhone }) => {
          const existing = await this.lockCredential(manager, credentialHash);
          this.assertOwnedClaim(
            existing,
            asSnapshot(existing.responseSnapshot),
            claim.claimId,
          );
          const result = await mergeVerifiedPhone({
            authenticatedUserId: currentUser.id,
            normalizedPhone: phoneNumber,
          });
          existing.status = WechatCredentialStatus.COMPLETED;
          existing.resourceUserId = result.userId;
          existing.responseSnapshot = completedPhoneSnapshot(
            currentUser.id,
            result.userId,
          );
          await manager.getRepository(WechatCredentialUse).save(existing);
          return result;
        },
      );
      return this.buildCustomerSession(merged.user);
    } catch (error) {
      if (error instanceof WechatAuthAdapterError) {
        await this.failClaim(credentialHash, claim.claimId, error.code);
        throw safeFailure(error.code);
      }
      if (error instanceof UserIdentityMergeRejectedError) {
        await this.identityMerge.recordRejectedConflict(error);
        const code = deterministicMergeFailureCode(error.conflict);
        if (code) await this.failClaim(credentialHash, claim.claimId, code);
        throw error.conflict;
      }
      const deterministicCode = deterministicMergeFailureCode(error);
      if (deterministicCode) {
        await this.failClaim(credentialHash, claim.claimId, deterministicCode);
        throw safeFailure(deterministicCode);
      }
      await this.releaseClaimOnInternalFailure(credentialHash, claim.claimId);
      throw error;
    }
  }

  private async acquireClaim(
    kind: WechatCredentialKind,
    credentialHash: string,
    now: Date,
    sourceUserId?: string,
  ): Promise<ClaimAcquisition> {
    const claimId = randomUUID();
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(WechatCredentialUse);
      try {
        await repository.insert({
          kind,
          credentialHash,
          status: WechatCredentialStatus.IN_PROGRESS,
          expiresAt: new Date(now.getTime() + WECHAT_CREDENTIAL_TTL_MS),
          resourceUserId: null,
          responseSnapshot: sourceUserId
            ? ({
                version: 2,
                kind: 'CLAIM',
                claimId,
                principal: { sourceUserId },
              } satisfies PhoneClaimSnapshot)
            : ({
                version: 1,
                kind: 'CLAIM',
                claimId,
              } satisfies LoginClaimSnapshot),
        });
        return { state: 'OWNER', claimId };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }

      const existing = await this.lockCredential(manager, credentialHash);
      const snapshot = asSnapshot(existing.responseSnapshot);
      if (existing.kind !== kind) {
        throw new ConflictException({
          code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
          message: 'WeChat credential has already been used.',
        });
      }
      if (
        existing.status === WechatCredentialStatus.COMPLETED &&
        existing.resourceUserId &&
        snapshot?.kind === 'COMPLETED' &&
        snapshot.resource.userId === existing.resourceUserId
      ) {
        if (existing.expiresAt.getTime() <= now.getTime()) {
          throw replayConflict();
        }
        return {
          state: 'COMPLETED',
          resourceUserId: existing.resourceUserId,
          snapshot,
        };
      }
      if (existing.status === WechatCredentialStatus.FAILED) {
        if (snapshot?.kind !== 'FAILED') throw replayConflict();
        if (
          kind === WechatCredentialKind.PHONE &&
          (snapshot.version !== 2 ||
            snapshot.principal.sourceUserId !== sourceUserId)
        ) {
          throw replayConflict();
        }
        if (kind === WechatCredentialKind.LOGIN && snapshot.version !== 1) {
          throw replayConflict();
        }
        throw safeFailure(snapshot.failureCode);
      }
      if (
        kind === WechatCredentialKind.PHONE &&
        (snapshot?.kind !== 'CLAIM' ||
          snapshot.version !== 2 ||
          snapshot.principal.sourceUserId !== sourceUserId)
      ) {
        throw replayConflict();
      }
      if (
        existing.status === WechatCredentialStatus.IN_PROGRESS &&
        existing.expiresAt.getTime() > now.getTime()
      ) {
        throw processingConflict();
      }

      existing.status = WechatCredentialStatus.IN_PROGRESS;
      existing.expiresAt = new Date(now.getTime() + WECHAT_CREDENTIAL_TTL_MS);
      existing.resourceUserId = null;
      existing.responseSnapshot = sourceUserId
        ? ({
            version: 2,
            kind: 'CLAIM',
            claimId,
            principal: { sourceUserId },
          } satisfies PhoneClaimSnapshot)
        : ({
            version: 1,
            kind: 'CLAIM',
            claimId,
          } satisfies LoginClaimSnapshot);
      await repository.save(existing);
      return { state: 'OWNER', claimId };
    });
  }

  private async resolveWechatUser(
    identity: WechatLoginIdentity,
  ): Promise<User> {
    try {
      return await this.dataSource.transaction((manager) =>
        this.resolveWechatUserInTransaction(identity, manager),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.dataSource.transaction((manager) =>
        this.requireCanonicalWechatUser(identity, manager),
      );
    }
  }

  private async resolveWechatUserInTransaction(
    identity: WechatLoginIdentity,
    manager: EntityManager,
  ): Promise<User> {
    const existing = await this.findCanonicalWechatUser(identity, manager);
    if (existing) {
      if (!existing.wechatOpenid) existing.wechatOpenid = identity.openid;
      if (!existing.wechatUnionid && identity.unionid) {
        existing.wechatUnionid = identity.unionid;
      }
      return manager.getRepository(User).save(existing);
    }
    return this.identities.createWechatUser(identity, manager);
  }

  private async requireCanonicalWechatUser(
    identity: WechatLoginIdentity,
    manager: EntityManager,
  ): Promise<User> {
    const winner = await this.findCanonicalWechatUser(identity, manager);
    if (!winner) throw replayConflict();
    return winner;
  }

  private async findCanonicalWechatUser(
    identity: WechatLoginIdentity,
    manager: EntityManager,
  ): Promise<User | null> {
    const candidates = await manager.getRepository(User).find({
      where: [
        { wechatOpenid: identity.openid },
        ...(identity.unionid ? [{ wechatUnionid: identity.unionid }] : []),
      ],
    });
    const active = candidates.filter(
      ({ isActive, mergedIntoUserId }) => isActive && !mergedIntoUserId,
    );
    const ids = new Set(active.map(({ id }) => id));
    if (ids.size > 1) {
      throw new ConflictException({
        code: ApiErrorCode.WECHAT_IDENTITY_CONFLICT,
        message: 'WeChat identity requires manual review.',
      });
    }
    return active[0] ?? null;
  }

  private async sessionForResource(
    resourceUserId: string,
  ): Promise<CustomerAuthSessionView> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: {
        id: resourceUserId,
        isActive: true,
        mergedIntoUserId: IsNull(),
      },
    });
    if (!user) throw new NotFoundException('Canonical user no longer exists');
    return this.buildCustomerSession(user);
  }

  private buildCustomerSession(user: User): CustomerAuthSessionView {
    return {
      ...this.userAuth.issueSession(user),
      profile: mapProfile(user),
    };
  }

  private async completeClaim(
    credentialHash: string,
    claimId: string,
    resourceUserId: string,
    sourceUserId?: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const existing = await this.lockCredential(manager, credentialHash);
      const snapshot = asSnapshot(existing.responseSnapshot);
      if (
        existing.status === WechatCredentialStatus.COMPLETED &&
        existing.resourceUserId === resourceUserId &&
        snapshot?.kind === 'COMPLETED' &&
        snapshot.resource.userId === resourceUserId
      ) {
        return;
      }
      this.assertOwnedClaim(existing, snapshot, claimId);
      existing.status = WechatCredentialStatus.COMPLETED;
      existing.resourceUserId = resourceUserId;
      existing.responseSnapshot = sourceUserId
        ? completedPhoneSnapshot(sourceUserId, resourceUserId)
        : completedSnapshot(resourceUserId);
      await manager.getRepository(WechatCredentialUse).save(existing);
    });
  }

  private async failClaim(
    credentialHash: string,
    claimId: string,
    failureCode: DeterministicFailureCode,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const existing = await this.lockOwnedClaim(
        manager,
        credentialHash,
        claimId,
      );
      const snapshot = asSnapshot(existing.responseSnapshot);
      existing.status = WechatCredentialStatus.FAILED;
      existing.resourceUserId = null;
      existing.responseSnapshot =
        snapshot?.kind === 'CLAIM' && snapshot.version === 2
          ? ({
              version: 2,
              kind: 'FAILED',
              principal: {
                sourceUserId: snapshot.principal.sourceUserId,
              },
              failureCode,
            } satisfies PhoneFailedSnapshot)
          : ({
              version: 1,
              kind: 'FAILED',
              failureCode,
            } satisfies LoginFailedSnapshot);
      await manager.getRepository(WechatCredentialUse).save(existing);
    });
  }

  private async releaseClaimOnInternalFailure(
    credentialHash: string,
    claimId: string,
  ): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const existing = await this.lockCredential(manager, credentialHash);
        const snapshot = asSnapshot(existing.responseSnapshot);
        if (
          existing.status === WechatCredentialStatus.IN_PROGRESS &&
          snapshot?.kind === 'CLAIM' &&
          snapshot.claimId === claimId
        ) {
          existing.expiresAt = new Date(0);
          await manager.getRepository(WechatCredentialUse).save(existing);
        }
      });
    } catch {
      // Preserve the original internal failure; stale claims remain bounded by TTL.
    }
  }

  private async lockOwnedClaim(
    manager: EntityManager,
    credentialHash: string,
    claimId: string,
  ): Promise<WechatCredentialUse> {
    const existing = await this.lockCredential(manager, credentialHash);
    this.assertOwnedClaim(
      existing,
      asSnapshot(existing.responseSnapshot),
      claimId,
    );
    return existing;
  }

  private assertOwnedClaim(
    existing: WechatCredentialUse,
    snapshot: CredentialSnapshot | null,
    claimId: string,
  ): void {
    if (
      existing.status !== WechatCredentialStatus.IN_PROGRESS ||
      snapshot?.kind !== 'CLAIM' ||
      snapshot.claimId !== claimId
    ) {
      throw processingConflict();
    }
  }

  private async lockCredential(
    manager: EntityManager,
    credentialHash: string,
  ): Promise<WechatCredentialUse> {
    const existing = await manager
      .getRepository(WechatCredentialUse)
      .createQueryBuilder('credential')
      .setLock('pessimistic_write')
      .where('credential.credentialHash = :credentialHash', { credentialHash })
      .getOne();
    if (!existing) throw new NotFoundException('Credential claim disappeared');
    return existing;
  }
}
