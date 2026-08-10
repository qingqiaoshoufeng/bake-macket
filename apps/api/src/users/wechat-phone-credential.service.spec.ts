import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ApiErrorCode } from '@bake-mall/contracts';

import {
  WechatCredentialKind,
  WechatCredentialStatus,
  WechatCredentialUse,
} from '../database/entities/wechat-credential-use.entity.js';
import { User } from '../database/entities/user.entity.js';
import {
  buildPhoneClaimFingerprint,
  hashWechatCredential,
  type PhoneCredentialSnapshot,
  WechatPhoneCredentialService,
} from './wechat-phone-credential.service.js';

const NOW = new Date('2026-08-04T08:00:00.000Z');
const SECRET = 'fixed-test-user-secret';

type CredentialState = {
  credential: WechatCredentialUse | null;
  users: Map<string, User>;
  transactionManagers: object[];
  lockManager?: object;
  events: string[];
  ignoredInsertIdentifiers: boolean;
};

const credentialRow = (
  overrides: Partial<WechatCredentialUse>,
): WechatCredentialUse =>
  Object.assign(new WechatCredentialUse(), {
    id: '1',
    kind: WechatCredentialKind.PHONE,
    credentialHash: hashWechatCredential('credential'),
    status: WechatCredentialStatus.IN_PROGRESS,
    expiresAt: new Date(NOW.getTime() + 60_000),
    resourceUserId: 'source-1',
    responseSnapshot: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

const buildStatefulDataSource = (
  initial?: Partial<CredentialState>,
): { dataSource: object; state: CredentialState } => {
  const state: CredentialState = {
    credential: initial?.credential ?? null,
    users: initial?.users ?? new Map<string, User>(),
    transactionManagers: [],
    events: [],
    ignoredInsertIdentifiers: initial?.ignoredInsertIdentifiers ?? false,
  };
  const credentialRepository = {
    createQueryBuilder: vi.fn((alias?: string) => {
      if (alias) {
        return {
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn(async () => state.credential),
        };
      }
      let values: Partial<WechatCredentialUse> | undefined;
      const builder = {
        insert: vi.fn(),
        values: vi.fn((next: Partial<WechatCredentialUse>) => {
          values = next;
          return builder;
        }),
        orIgnore: vi.fn(),
        execute: vi.fn(async () => {
          if (state.credential) {
            return {
              identifiers: state.ignoredInsertIdentifiers ? [{ id: '1' }] : [],
            };
          }
          state.credential = credentialRow({ id: '1', ...values });
          return { identifiers: [{ id: '1' }] };
        }),
      };
      builder.insert.mockReturnValue(builder);
      builder.orIgnore.mockReturnValue(builder);
      return builder;
    }),
    save: vi.fn(async (value: WechatCredentialUse) => {
      state.credential = value;
      return value;
    }),
  };
  const manager = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === WechatCredentialUse) return credentialRepository;
      throw new Error(`unexpected transaction repository: ${String(entity)}`);
    }),
  };
  const dataSource = {
    transaction: vi.fn(async (operation: (value: object) => unknown) => {
      state.transactionManagers.push(manager);
      return operation(manager);
    }),
    getRepository: vi.fn((entity: unknown) => {
      if (entity !== User) throw new Error('unexpected data source repository');
      return {
        findOne: vi.fn(async ({ where }: { where: { id: string } }) =>
          state.users.get(where.id),
        ),
      };
    }),
  };
  return { dataSource, state };
};

const completedUser = (id: string): User =>
  Object.assign(new User(), {
    id,
    phone: '13800000000',
    phoneVerified: true,
    isActive: true,
    mergedIntoUserId: null,
    tokenVersion: 2,
  });

const buildService = (input?: {
  credential?: WechatCredentialUse | null;
  merge?: ReturnType<typeof vi.fn>;
  users?: Map<string, User>;
  ignoredInsertIdentifiers?: boolean;
}) => {
  const { dataSource, state } = buildStatefulDataSource({
    credential: input?.credential ?? null,
    users: input?.users,
    ignoredInsertIdentifiers: input?.ignoredInsertIdentifiers ?? false,
  });
  const merge =
    input?.merge ??
    vi.fn(async ({ authenticatedUserId, manager }) => ({
      userId: authenticatedUserId,
      user: completedUser(authenticatedUserId),
      migrated: { addresses: 0, cartItems: 0 },
      operatorChanged: false,
      manager,
    }));
  const lockManager = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity !== WechatCredentialUse) {
        throw new Error(`unexpected phone-lock repository: ${String(entity)}`);
      }
      return {
        createQueryBuilder: vi.fn(() => ({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn(async () => state.credential),
        })),
        save: vi.fn(async (value: WechatCredentialUse) => {
          state.credential = value;
          return value;
        }),
      };
    }),
  };
  state.lockManager = lockManager;
  const withPhoneLock = vi.fn(
    async (
      _phone: string,
      operation: (context: {
        manager: object;
        mergeVerifiedPhone: (input: object) => Promise<unknown>;
      }) => Promise<unknown>,
    ) =>
      operation({
        manager: lockManager,
        mergeVerifiedPhone: (value) =>
          merge({ ...value, manager: lockManager }),
      }),
  );
  const service = new WechatPhoneCredentialService(
    dataSource as never,
    {
      get: vi.fn().mockReturnValue({ JWT_USER_SECRET: SECRET }),
    } as never,
    {
      mergeVerifiedPhone: merge,
      withPhoneLock,
      recordRejectedConflict: vi.fn(),
    } as never,
  );
  return { service, merge, withPhoneLock, state };
};

const bind = (
  service: WechatPhoneCredentialService,
  overrides: Partial<Parameters<typeof service.bindVerifiedPhone>[0]> = {},
) =>
  service.bindVerifiedPhone({
    rawCredential: 'credential',
    sourceUserId: 'source-1',
    normalizedPhone: '13800000000',
    now: NOW,
    ...overrides,
  });

const expectConflictCode = async (
  promise: Promise<unknown>,
  code: ApiErrorCode,
): Promise<void> => {
  await expect(promise).rejects.toThrow(ConflictException);
  await expect(promise).rejects.toMatchObject({
    response: expect.objectContaining({ code }),
  });
};

describe('WeChat phone credential protection', () => {
  it('只对 raw credential 保存稳定 SHA-256，且摘要不包含明文', () => {
    const rawCredential = 'wx-phone-code-secret-value';
    const digest = hashWechatCredential(rawCredential);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digest).not.toContain(rawCredential);
    expect(hashWechatCredential(rawCredential)).toBe(digest);
  });

  it('使用带用途域的服务端 HMAC 绑定 source、phone 与 kind', () => {
    const first = buildPhoneClaimFingerprint({
      secret: SECRET,
      sourceUserId: '12',
      normalizedPhone: '13800000000',
    });
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toContain('13800000000');
    expect(
      buildPhoneClaimFingerprint({
        secret: SECRET,
        sourceUserId: '13',
        normalizedPhone: '13800000000',
      }),
    ).not.toBe(first);
  });

  it('credential snapshot 仅允许版本化 claim/completed 元数据', () => {
    const claim: PhoneCredentialSnapshot = {
      version: 1,
      kind: 'CLAIM',
      requestFingerprint: 'a'.repeat(64),
      claimId: 'claim-attempt-id',
    };
    const completed: PhoneCredentialSnapshot = {
      version: 1,
      kind: 'COMPLETED',
      requestFingerprint: 'a'.repeat(64),
      canonicalUserId: '9',
    };
    expect(JSON.stringify([claim, completed])).not.toMatch(
      /phone|openid|accessToken|wx-phone-code/u,
    );
  });
});

describe('WechatPhoneCredentialService state machine', () => {
  it('首次 claim 后在 phone lock 同一事务执行 merge 与 COMPLETED，并且 snapshot 无 token/phone', async () => {
    const { service, merge, withPhoneLock, state } = buildService();
    const result = await bind(service);

    expect(result).toMatchObject({
      canonicalUserId: 'source-1',
      replayed: false,
    });
    expect(merge).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedUserId: 'source-1',
        normalizedPhone: '13800000000',
        manager: state.lockManager,
      }),
    );
    expect(withPhoneLock).toHaveBeenCalledWith(
      '13800000000',
      expect.any(Function),
    );
    expect(state.transactionManagers).toHaveLength(1);
    expect(state.credential).toMatchObject({
      status: WechatCredentialStatus.COMPLETED,
      resourceUserId: 'source-1',
      responseSnapshot: {
        version: 1,
        kind: 'COMPLETED',
        canonicalUserId: 'source-1',
      },
    });
    expect(JSON.stringify(state.credential?.responseSnapshot)).not.toMatch(
      /13800000000|accessToken|credential/u,
    );
  });

  it('同 fingerprint 未过期 IN_PROGRESS 返回处理中冲突', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const merge = vi.fn(async () => {
      await pending;
      return {
        userId: 'source-1',
        user: completedUser('source-1'),
        migrated: { addresses: 0, cartItems: 0 },
        operatorChanged: false,
      };
    });
    const { service } = buildService({ merge });
    const first = bind(service);
    await vi.waitFor(() => expect(merge).toHaveBeenCalledTimes(1));

    await expectConflictCode(
      bind(service),
      ApiErrorCode.WECHAT_CREDENTIAL_IN_PROGRESS,
    );
    release();
    await first;
  });

  it('不同 fingerprint 一律 replay 冲突，不能 reclaim 过期或 FAILED claim', async () => {
    for (const status of [
      WechatCredentialStatus.IN_PROGRESS,
      WechatCredentialStatus.FAILED,
    ]) {
      const fingerprint = buildPhoneClaimFingerprint({
        secret: SECRET,
        sourceUserId: 'other-source',
        normalizedPhone: '13900000000',
      });
      const credential = credentialRow({
        status,
        expiresAt: new Date(NOW.getTime() - 1),
        resourceUserId: 'other-source',
        responseSnapshot: {
          version: 1,
          kind: 'CLAIM',
          requestFingerprint: fingerprint,
        },
      });
      const { service, merge } = buildService({ credential });
      await expectConflictCode(
        bind(service),
        ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
      );
      expect(merge).not.toHaveBeenCalled();
    }
  });

  it('不信任 orIgnore 的 identifiers，而以锁后持久 claimId 判定插入归属', async () => {
    const fingerprint = buildPhoneClaimFingerprint({
      secret: SECRET,
      sourceUserId: 'source-1',
      normalizedPhone: '13800000000',
    });
    const { service, merge } = buildService({
      ignoredInsertIdentifiers: true,
      credential: credentialRow({
        status: WechatCredentialStatus.IN_PROGRESS,
        resourceUserId: 'source-1',
        responseSnapshot: {
          version: 1,
          kind: 'CLAIM',
          requestFingerprint: fingerprint,
          claimId: 'existing-claim',
        },
      }),
    });

    await expectConflictCode(
      bind(service),
      ApiErrorCode.WECHAT_CREDENTIAL_IN_PROGRESS,
    );
    expect(merge).not.toHaveBeenCalled();
  });

  it('相同 fingerprint 但不同 IN_PROGRESS owner 也不能 reclaim', async () => {
    const fingerprint = buildPhoneClaimFingerprint({
      secret: SECRET,
      sourceUserId: 'source-1',
      normalizedPhone: '13800000000',
    });
    const { service, merge } = buildService({
      credential: credentialRow({
        status: WechatCredentialStatus.IN_PROGRESS,
        expiresAt: new Date(NOW.getTime() - 1),
        resourceUserId: 'other-source',
        responseSnapshot: {
          version: 1,
          kind: 'CLAIM',
          requestFingerprint: fingerprint,
        },
      }),
    });

    await expectConflictCode(
      bind(service),
      ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
    );
    expect(merge).not.toHaveBeenCalled();
  });

  it('同 fingerprint COMPLETED 从 canonical resource 安全重放且不再次 merge', async () => {
    const fingerprint = buildPhoneClaimFingerprint({
      secret: SECRET,
      sourceUserId: 'source-1',
      normalizedPhone: '13800000000',
    });
    const canonical = completedUser('canonical-9');
    const { service, merge } = buildService({
      credential: credentialRow({
        status: WechatCredentialStatus.COMPLETED,
        resourceUserId: canonical.id,
        responseSnapshot: {
          version: 1,
          kind: 'COMPLETED',
          requestFingerprint: fingerprint,
          canonicalUserId: canonical.id,
        },
      }),
      users: new Map([[canonical.id, canonical]]),
    });

    await expect(bind(service)).resolves.toMatchObject({
      canonicalUserId: canonical.id,
      user: canonical,
      replayed: true,
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it.each([WechatCredentialStatus.IN_PROGRESS, WechatCredentialStatus.FAILED])(
    '同 fingerprint 可从过期/FAILED 状态 %s reclaim',
    async (status) => {
      const fingerprint = buildPhoneClaimFingerprint({
        secret: SECRET,
        sourceUserId: 'source-1',
        normalizedPhone: '13800000000',
      });
      const { service, merge } = buildService({
        credential: credentialRow({
          status,
          expiresAt: new Date(NOW.getTime() - 1),
          responseSnapshot: {
            version: 1,
            kind: 'CLAIM',
            requestFingerprint: fingerprint,
          },
        }),
      });

      await expect(bind(service)).resolves.toMatchObject({ replayed: false });
      expect(merge).toHaveBeenCalledTimes(1);
    },
  );

  it('merge 失败只把当前 owner 的 IN_PROGRESS 标为 FAILED', async () => {
    const mergeError = new Error('merge failed');
    const { service, state } = buildService({
      merge: vi.fn().mockRejectedValue(mergeError),
    });

    await expect(bind(service)).rejects.toBe(mergeError);
    expect(state.credential).toMatchObject({
      status: WechatCredentialStatus.FAILED,
      resourceUserId: 'source-1',
    });
  });

  it('旧 attempt 的 markFailed 不覆盖同 owner/fingerprint 的新 reclaim', async () => {
    const fingerprint = buildPhoneClaimFingerprint({
      secret: SECRET,
      sourceUserId: 'source-1',
      normalizedPhone: '13800000000',
    });
    const credential = credentialRow({
      status: WechatCredentialStatus.IN_PROGRESS,
      resourceUserId: 'source-1',
      responseSnapshot: {
        version: 1,
        kind: 'CLAIM',
        requestFingerprint: fingerprint,
        claimId: 'new-attempt',
      },
    });
    const { service, state } = buildService({ credential });
    const internal = service as unknown as {
      markFailed: (
        hash: string,
        requestFingerprint: string,
        sourceUserId: string,
        claimId: string,
      ) => Promise<void>;
    };

    await internal.markFailed(
      credential.credentialHash,
      fingerprint,
      'source-1',
      'old-attempt',
    );

    expect(state.credential?.status).toBe(WechatCredentialStatus.IN_PROGRESS);
  });

  it('markFailed 不覆盖 COMPLETED 或其他 owner', async () => {
    const fingerprint = buildPhoneClaimFingerprint({
      secret: SECRET,
      sourceUserId: 'source-1',
      normalizedPhone: '13800000000',
    });
    for (const credential of [
      credentialRow({
        status: WechatCredentialStatus.COMPLETED,
        resourceUserId: 'source-1',
        responseSnapshot: {
          version: 1,
          kind: 'COMPLETED',
          requestFingerprint: fingerprint,
          canonicalUserId: 'source-1',
        },
      }),
      credentialRow({
        status: WechatCredentialStatus.IN_PROGRESS,
        resourceUserId: 'other-source',
        responseSnapshot: {
          version: 1,
          kind: 'CLAIM',
          requestFingerprint: fingerprint,
        },
      }),
    ]) {
      const { service, state } = buildService({ credential });
      const internal = service as unknown as {
        markFailed: (
          hash: string,
          requestFingerprint: string,
          sourceUserId: string,
          claimId?: string,
        ) => Promise<void>;
      };
      await internal.markFailed(
        credential.credentialHash,
        fingerprint,
        'source-1',
      );
      expect(state.credential?.status).toBe(credential.status);
    }
  });
});
