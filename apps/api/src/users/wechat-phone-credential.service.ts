import { createHash, createHmac, randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { ApiErrorCode } from '@bake-mall/contracts';

import { type AppConfig } from '../config/env.schema.js';
import {
  WechatCredentialKind,
  WechatCredentialStatus,
  WechatCredentialUse,
} from '../database/entities/wechat-credential-use.entity.js';
import { User } from '../database/entities/user.entity.js';
import {
  UserIdentityMergeRejectedError,
  UserIdentityMergeService,
} from './user-identity-merge.service.js';
import { normalizePhone } from './user-identity.service.js';

const CLAIM_FINGERPRINT_DOMAIN = 'bake-mall:wechat-phone-claim:v1';
const CLAIM_TTL_MS = 5 * 60 * 1000;

export type PhoneCredentialSnapshot =
  | {
      version: 1;
      kind: 'CLAIM';
      requestFingerprint: string;
      claimId: string;
    }
  | {
      version: 1;
      kind: 'COMPLETED';
      requestFingerprint: string;
      canonicalUserId: string;
    };

export const hashWechatCredential = (rawCredential: string): string =>
  createHash('sha256').update(rawCredential, 'utf8').digest('hex');

export const buildPhoneClaimFingerprint = (input: {
  secret: string;
  sourceUserId: string;
  normalizedPhone: string;
}): string =>
  createHmac('sha256', input.secret)
    .update(CLAIM_FINGERPRINT_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(WechatCredentialKind.PHONE, 'utf8')
    .update('\0', 'utf8')
    .update(input.sourceUserId, 'utf8')
    .update('\0', 'utf8')
    .update(input.normalizedPhone, 'utf8')
    .digest('hex');

const credentialConflict = (
  code:
    | ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED
    | ApiErrorCode.WECHAT_CREDENTIAL_IN_PROGRESS,
): ConflictException =>
  new ConflictException({
    code,
    message:
      code === ApiErrorCode.WECHAT_CREDENTIAL_IN_PROGRESS
        ? 'WeChat credential is already being processed.'
        : 'WeChat credential has already been used for another request.',
  });

const snapshotFingerprint = (
  snapshot: Record<string, unknown> | null,
): string | null => {
  if (
    snapshot?.version !== 1 ||
    (snapshot.kind !== 'CLAIM' && snapshot.kind !== 'COMPLETED') ||
    typeof snapshot.requestFingerprint !== 'string'
  ) {
    return null;
  }
  return snapshot.requestFingerprint;
};

const snapshotClaimId = (
  snapshot: Record<string, unknown> | null,
): string | null =>
  snapshot?.version === 1 &&
  snapshot.kind === 'CLAIM' &&
  typeof snapshot.claimId === 'string'
    ? snapshot.claimId
    : null;

export type BindWechatPhoneInput = {
  rawCredential: string;
  sourceUserId: string;
  normalizedPhone: string;
  now?: Date;
};

export type BindWechatPhoneResult = {
  user: User;
  canonicalUserId: string;
  replayed: boolean;
};

@Injectable()
export class WechatPhoneCredentialService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly identityMerge: UserIdentityMergeService,
  ) {}

  /**
   * Consumes a credential only after its vendor authenticity has been verified.
   * Callers must perform that external verification before invoking this method.
   */
  async bindVerifiedPhone(
    input: BindWechatPhoneInput,
  ): Promise<BindWechatPhoneResult> {
    const phone = normalizePhone(input.normalizedPhone);
    const now = input.now ?? new Date();
    const credentialHash = hashWechatCredential(input.rawCredential);
    const secret = this.config.get('appEnv', { infer: true }).JWT_USER_SECRET;
    const requestFingerprint = buildPhoneClaimFingerprint({
      secret,
      sourceUserId: input.sourceUserId,
      normalizedPhone: phone,
    });
    const claimId = randomUUID();

    const acquisition = await this.acquireClaim({
      credentialHash,
      requestFingerprint,
      claimId,
      sourceUserId: input.sourceUserId,
      now,
    });
    if (acquisition.completedUserId) {
      const user = await this.dataSource.getRepository(User).findOne({
        where: {
          id: acquisition.completedUserId,
          isActive: true,
          mergedIntoUserId: IsNull(),
        },
      });
      if (!user) throw new NotFoundException('Canonical user no longer exists');
      return { user, canonicalUserId: user.id, replayed: true };
    }

    try {
      return await this.identityMerge.withPhoneLock(
        phone,
        async ({ manager, mergeVerifiedPhone }) => {
          const credential = await this.lockCredential(manager, credentialHash);
          if (
            credential.status !== WechatCredentialStatus.IN_PROGRESS ||
            credential.resourceUserId !== input.sourceUserId ||
            snapshotFingerprint(credential.responseSnapshot) !==
              requestFingerprint ||
            snapshotClaimId(credential.responseSnapshot) !== claimId
          ) {
            throw credentialConflict(ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED);
          }

          const merged = await mergeVerifiedPhone({
            authenticatedUserId: input.sourceUserId,
            normalizedPhone: phone,
          });
          credential.status = WechatCredentialStatus.COMPLETED;
          credential.resourceUserId = merged.userId;
          credential.responseSnapshot = {
            version: 1,
            kind: 'COMPLETED',
            requestFingerprint,
            canonicalUserId: merged.userId,
          } satisfies PhoneCredentialSnapshot;
          await manager.getRepository(WechatCredentialUse).save(credential);
          return {
            user: merged.user,
            canonicalUserId: merged.userId,
            replayed: false,
          };
        },
      );
    } catch (error) {
      await this.markFailed(
        credentialHash,
        requestFingerprint,
        input.sourceUserId,
        claimId,
      );
      if (error instanceof UserIdentityMergeRejectedError) {
        await this.identityMerge.recordRejectedConflict(error);
        throw error.conflict;
      }
      throw error;
    }
  }

  private async acquireClaim(input: {
    credentialHash: string;
    requestFingerprint: string;
    claimId: string;
    sourceUserId: string;
    now: Date;
  }): Promise<{ completedUserId: string | null }> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(WechatCredentialUse);
      await repository
        .createQueryBuilder()
        .insert()
        .values({
          kind: WechatCredentialKind.PHONE,
          credentialHash: input.credentialHash,
          status: WechatCredentialStatus.IN_PROGRESS,
          expiresAt: new Date(input.now.getTime() + CLAIM_TTL_MS),
          resourceUserId: input.sourceUserId,
          responseSnapshot: {
            version: 1,
            kind: 'CLAIM',
            requestFingerprint: input.requestFingerprint,
            claimId: input.claimId,
          } satisfies PhoneCredentialSnapshot,
        })
        .orIgnore()
        .execute();
      const credential = await this.lockCredential(
        manager,
        input.credentialHash,
      );
      const fingerprint = snapshotFingerprint(credential.responseSnapshot);
      if (snapshotClaimId(credential.responseSnapshot) === input.claimId) {
        return { completedUserId: null };
      }
      if (fingerprint !== input.requestFingerprint) {
        throw credentialConflict(ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED);
      }
      if (
        credential.status !== WechatCredentialStatus.COMPLETED &&
        credential.resourceUserId !== input.sourceUserId
      ) {
        throw credentialConflict(ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED);
      }
      if (credential.status === WechatCredentialStatus.COMPLETED) {
        const snapshot = credential.responseSnapshot;
        if (
          snapshot?.kind !== 'COMPLETED' ||
          typeof snapshot.canonicalUserId !== 'string' ||
          credential.resourceUserId !== snapshot.canonicalUserId
        ) {
          throw credentialConflict(ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED);
        }
        return { completedUserId: snapshot.canonicalUserId };
      }
      if (
        credential.status === WechatCredentialStatus.IN_PROGRESS &&
        credential.expiresAt.getTime() > input.now.getTime()
      ) {
        throw credentialConflict(ApiErrorCode.WECHAT_CREDENTIAL_IN_PROGRESS);
      }

      credential.kind = WechatCredentialKind.PHONE;
      credential.status = WechatCredentialStatus.IN_PROGRESS;
      credential.expiresAt = new Date(input.now.getTime() + CLAIM_TTL_MS);
      credential.resourceUserId = input.sourceUserId;
      credential.responseSnapshot = {
        version: 1,
        kind: 'CLAIM',
        requestFingerprint: input.requestFingerprint,
        claimId: input.claimId,
      } satisfies PhoneCredentialSnapshot;
      await repository.save(credential);
      return { completedUserId: null };
    });
  }

  private async markFailed(
    credentialHash: string,
    requestFingerprint: string,
    sourceUserId: string,
    claimId: string,
  ): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const credential = await this.lockCredential(manager, credentialHash);
        if (
          credential.status === WechatCredentialStatus.IN_PROGRESS &&
          credential.resourceUserId === sourceUserId &&
          snapshotFingerprint(credential.responseSnapshot) ===
            requestFingerprint &&
          snapshotClaimId(credential.responseSnapshot) === claimId
        ) {
          credential.status = WechatCredentialStatus.FAILED;
          await manager.getRepository(WechatCredentialUse).save(credential);
        }
      });
    } catch {
      // Keep the original merge/database error. The expiring claim remains safe.
    }
  }

  private async lockCredential(
    manager: EntityManager,
    credentialHash: string,
  ): Promise<WechatCredentialUse> {
    const credential = await manager
      .getRepository(WechatCredentialUse)
      .createQueryBuilder('credential')
      .setLock('pessimistic_write')
      .where('credential.credentialHash = :credentialHash', { credentialHash })
      .getOne();
    if (!credential)
      throw new NotFoundException('Credential claim disappeared');
    return credential;
  }
}
