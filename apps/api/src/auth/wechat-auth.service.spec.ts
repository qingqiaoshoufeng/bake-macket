import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ConflictException } from '@nestjs/common';

import { ApiErrorCode } from '@bake-mall/contracts';

import {
  WechatCredentialKind,
  WechatCredentialStatus,
  WechatCredentialUse,
} from '../database/entities/wechat-credential-use.entity.js';
import { User } from '../database/entities/user.entity.js';
import { WechatAuthAdapterError } from './wechat-auth.adapter.js';
import {
  WECHAT_CREDENTIAL_TTL_MS,
  hashWechatCredential,
  WechatAuthService,
} from './wechat-auth.service.js';

const NOW = new Date('2026-08-06T08:00:00.000Z');

type MemoryState = {
  credential: WechatCredentialUse | null;
  users: User[];
  events: string[];
  transactionDepth: number;
};

function user(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: '1',
    wechatOpenid: 'openid-1',
    wechatUnionid: null,
    nickname: null,
    avatarUrl: null,
    phone: null,
    phoneVerified: false,
    orderContactPhone: null,
    orderContactPhoneVersion: 0,
    isActive: true,
    mergedIntoUserId: null,
    tokenVersion: 1,
    ...overrides,
  });
}

function credential(
  overrides: Partial<WechatCredentialUse> = {},
): WechatCredentialUse {
  return Object.assign(new WechatCredentialUse(), {
    id: '1',
    kind: WechatCredentialKind.LOGIN,
    credentialHash: hashWechatCredential('login-code'),
    status: WechatCredentialStatus.IN_PROGRESS,
    expiresAt: new Date(NOW.getTime() + WECHAT_CREDENTIAL_TTL_MS),
    resourceUserId: null,
    responseSnapshot: {
      version: 1,
      kind: 'CLAIM',
      claimId: 'existing-claim',
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function buildMemoryDataSource(initial: Partial<MemoryState> = {}) {
  const state: MemoryState = {
    credential: initial.credential ?? null,
    users: initial.users ?? [],
    events: initial.events ?? [],
    transactionDepth: 0,
  };
  const credentialRepository = {
    insert: vi.fn(async (value: Partial<WechatCredentialUse>) => {
      if (state.credential) {
        throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      }
      state.credential = credential(value);
      return { identifiers: [{ id: '1' }] };
    }),
    save: vi.fn(async (value: WechatCredentialUse) => {
      state.credential = value;
      return value;
    }),
    createQueryBuilder: vi.fn(() => ({
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn(async () => state.credential),
    })),
  };
  const userRepository = {
    find: vi.fn(async ({ where }: { where: Array<Partial<User>> }) =>
      state.users.filter((candidate) =>
        where.some((selector) =>
          Object.entries(selector).every(
            ([key, value]) => candidate[key as keyof User] === value,
          ),
        ),
      ),
    ),
    findOne: vi.fn(
      async ({ where }: { where: Partial<User> | Array<Partial<User>> }) => {
        const selectors = Array.isArray(where) ? where : [where];
        return state.users.find((candidate) =>
          selectors.some((selector) =>
            Object.entries(selector).every(([key, value]) => {
              const current = candidate[key as keyof User];
              return key === 'mergedIntoUserId' && typeof value === 'object'
                ? current === null
                : current === value;
            }),
          ),
        );
      },
    ),
    create: vi.fn((value: Partial<User>) =>
      user({ id: String(state.users.length + 1), ...value }),
    ),
    save: vi.fn(async (value: User) => {
      state.users = [...state.users.filter(({ id }) => id !== value.id), value];
      return value;
    }),
  };
  const manager = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === WechatCredentialUse) return credentialRepository;
      if (entity === User) return userRepository;
      throw new Error(`unexpected entity ${String(entity)}`);
    }),
  };
  const dataSource = {
    transaction: vi.fn(
      async (operation: (value: typeof manager) => unknown) => {
        state.events.push('transaction:start');
        state.transactionDepth += 1;
        try {
          return await operation(manager);
        } finally {
          state.transactionDepth -= 1;
          state.events.push('transaction:end');
        }
      },
    ),
    getRepository: manager.getRepository,
  };
  return { dataSource, manager, state, userRepository };
}

function customerSession(value: User) {
  return {
    accessToken: `token-for-${value.id}-${value.tokenVersion}`,
    expiresAt: '2026-08-07T08:00:00.000Z',
  };
}

function buildService(initial: Partial<MemoryState> = {}) {
  const { dataSource, manager, state, userRepository } =
    buildMemoryDataSource(initial);
  const adapter = {
    exchangeLoginCode: vi.fn(async () => {
      state.events.push(
        state.transactionDepth === 0 ? 'vendor:outside' : 'vendor:inside',
      );
      return { openid: 'openid-1', unionid: 'unionid-1' };
    }),
    exchangePhoneCredential: vi.fn(async () => {
      state.events.push(
        state.transactionDepth === 0 ? 'vendor:outside' : 'vendor:inside',
      );
      return { phoneNumber: '13800000000' };
    }),
  };
  const mergeInTransaction = vi.fn(async ({ authenticatedUserId }) => ({
    userId: authenticatedUserId,
    user: user({
      id: authenticatedUserId,
      phone: '13800000000',
      phoneVerified: true,
      tokenVersion: 2,
    }),
    migrated: { addresses: 0, cartItems: 0 },
    operatorChanged: false,
  }));
  const merge = {
    mergeVerifiedPhone: vi.fn(),
    withPhoneLock: vi.fn(
      async (
        _phone: string,
        operation: (context: {
          manager: typeof manager;
          mergeVerifiedPhone: typeof mergeInTransaction;
        }) => Promise<unknown>,
      ) => {
        state.events.push('phone-lock:transaction:start');
        const result = await operation({
          manager,
          mergeVerifiedPhone: mergeInTransaction,
        });
        state.events.push('phone-lock:transaction:commit');
        return result;
      },
    ),
    mergeInTransaction,
    recordRejectedConflict: vi.fn(),
  };
  const sessions = {
    issueSession: vi.fn(customerSession),
  };
  const identities = {
    createWechatUser: vi.fn(
      async (identity: { openid: string; unionid: string | null }) => {
        if (
          state.users.some(
            ({ wechatOpenid, wechatUnionid }) =>
              wechatOpenid === identity.openid ||
              (identity.unionid !== null && wechatUnionid === identity.unionid),
          )
        ) {
          throw Object.assign(new Error('duplicate identity'), {
            code: 'ER_DUP_ENTRY',
          });
        }
        const created = user({
          id: String(state.users.length + 1),
          wechatOpenid: identity.openid,
          wechatUnionid: identity.unionid,
        });
        state.users = [...state.users, created];
        return created;
      },
    ),
  };
  const service = new WechatAuthService(
    dataSource as never,
    adapter as never,
    merge as never,
    identities as never,
    sessions as never,
  );
  return {
    service,
    adapter,
    merge,
    identities,
    sessions,
    state,
    userRepository,
  };
}

function completedSnapshot(userId: string) {
  return {
    version: 1,
    kind: 'COMPLETED',
    resource: { userId },
    session: { audience: 'mall-user' },
  };
}

function completedPhoneSnapshot(sourceUserId: string, canonicalUserId: string) {
  return {
    version: 2,
    kind: 'COMPLETED',
    principal: { sourceUserId, canonicalUserId },
    resource: { userId: canonicalUserId },
    session: { audience: 'mall-user' },
  };
}

function failedSnapshot(code: ApiErrorCode) {
  return { version: 1, kind: 'FAILED', failureCode: code };
}

describe('WechatAuthService credential state machine', () => {
  it('uses a stable SHA-256 digest and a 10 minute claim TTL for LOGIN outside vendor transactions', async () => {
    const { service, state } = buildService();

    await service.loginWithWechatCode('login-code', NOW);

    expect(hashWechatCredential('login-code')).toBe(
      createHash('sha256').update('login-code').digest('hex'),
    );
    expect(state.credential).toMatchObject({
      kind: WechatCredentialKind.LOGIN,
      credentialHash: hashWechatCredential('login-code'),
      status: WechatCredentialStatus.COMPLETED,
      expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
      resourceUserId: '1',
    });
    expect(state.events).toContain('vendor:outside');
    expect(state.events).not.toContain('vendor:inside');
    expect(JSON.stringify(state.credential?.responseSnapshot)).not.toMatch(
      /login-code|openid|unionid|accessToken|token-for/u,
    );
  });

  it('allows only one concurrent owner and reports an unexpired claim as in progress', async () => {
    let release!: () => void;
    const pendingVendor = new Promise<{
      openid: string;
      unionid: string;
    }>((resolve) => {
      release = () => resolve({ openid: 'openid-1', unionid: 'unionid-1' });
    });
    const { service, adapter } = buildService();
    adapter.exchangeLoginCode.mockReturnValueOnce(pendingVendor);

    const first = service.loginWithWechatCode('login-code', NOW);
    await vi.waitFor(() =>
      expect(adapter.exchangeLoginCode).toHaveBeenCalledTimes(1),
    );
    await expect(
      service.loginWithWechatCode('login-code', NOW),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.WECHAT_CREDENTIAL_IN_PROGRESS,
      }),
    });
    expect(adapter.exchangeLoginCode).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('原 owner 在过期 reclaim 已完成后返回等价成功而不是 409', async () => {
    let releaseFirst!: () => void;
    const firstVendor = new Promise<{ openid: string; unionid: string }>(
      (resolve) => {
        releaseFirst = () =>
          resolve({ openid: 'openid-1', unionid: 'unionid-1' });
      },
    );
    const { service, adapter, state } = buildService();
    adapter.exchangeLoginCode
      .mockReturnValueOnce(firstVendor)
      .mockResolvedValueOnce({ openid: 'openid-1', unionid: 'unionid-1' });

    const first = service.loginWithWechatCode('login-code', NOW);
    await vi.waitFor(() =>
      expect(adapter.exchangeLoginCode).toHaveBeenCalledTimes(1),
    );
    if (!state.credential) throw new Error('expected active claim');
    state.credential.expiresAt = new Date(NOW.getTime() - 1);
    const reclaimed = await service.loginWithWechatCode('login-code', NOW);
    releaseFirst();

    await expect(first).resolves.toMatchObject({
      profile: { id: reclaimed.profile.id },
    });
    expect(adapter.exchangeLoginCode).toHaveBeenCalledTimes(2);
  });

  it('atomically reclaims an expired IN_PROGRESS claim', async () => {
    const stale = credential({
      expiresAt: new Date(NOW.getTime() - 1),
      responseSnapshot: {
        version: 1,
        kind: 'CLAIM',
        claimId: 'stale-owner',
      },
    });
    const { service, adapter, state } = buildService({ credential: stale });

    await service.loginWithWechatCode('login-code', NOW);

    expect(adapter.exchangeLoginCode).toHaveBeenCalledOnce();
    expect(state.credential?.status).toBe(WechatCredentialStatus.COMPLETED);
    expect(state.credential?.responseSnapshot).not.toMatchObject({
      claimId: 'stale-owner',
    });
  });

  it('persists a safe FAILED category and replays it without calling the vendor again', async () => {
    const { service, adapter, state } = buildService();
    adapter.exchangeLoginCode.mockRejectedValueOnce(
      new WechatAuthAdapterError(ApiErrorCode.WECHAT_AUTH_FAILED),
    );

    await expect(
      service.loginWithWechatCode('login-code', NOW),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.WECHAT_AUTH_FAILED,
      }),
    });
    expect(state.credential).toMatchObject({
      status: WechatCredentialStatus.FAILED,
      resourceUserId: null,
      responseSnapshot: failedSnapshot(ApiErrorCode.WECHAT_AUTH_FAILED),
    });

    await expect(
      service.loginWithWechatCode('login-code', NOW),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.WECHAT_AUTH_FAILED,
      }),
    });
    expect(adapter.exchangeLoginCode).toHaveBeenCalledTimes(1);
  });

  it('replays COMPLETED LOGIN from resourceUserId by issuing a fresh equivalent session', async () => {
    const existing = user({ id: '9', tokenVersion: 4 });
    const completed = credential({
      status: WechatCredentialStatus.COMPLETED,
      resourceUserId: existing.id,
      responseSnapshot: completedSnapshot(existing.id),
    });
    const { service, adapter, sessions } = buildService({
      credential: completed,
      users: [existing],
    });

    await expect(
      service.loginWithWechatCode('login-code', NOW),
    ).resolves.toMatchObject({
      accessToken: 'token-for-9-4',
      profile: { id: '9', phoneVerified: false },
    });
    expect(adapter.exchangeLoginCode).not.toHaveBeenCalled();
    expect(sessions.issueSession).toHaveBeenCalledWith(existing);
  });

  it('rejects expired COMPLETED LOGIN without vendor access, session issuance, or reclaim', async () => {
    const existing = user({ id: '9', tokenVersion: 4 });
    const completed = credential({
      status: WechatCredentialStatus.COMPLETED,
      expiresAt: new Date(NOW.getTime() - 1),
      resourceUserId: existing.id,
      responseSnapshot: completedSnapshot(existing.id),
    });
    const { service, adapter, sessions, state } = buildService({
      credential: completed,
      users: [existing],
    });

    await expect(
      service.loginWithWechatCode('login-code', NOW),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
      }),
    });
    expect(adapter.exchangeLoginCode).not.toHaveBeenCalled();
    expect(sessions.issueSession).not.toHaveBeenCalled();
    expect(state.credential).toMatchObject({
      status: WechatCredentialStatus.COMPLETED,
      expiresAt: new Date(NOW.getTime() - 1),
      resourceUserId: existing.id,
      responseSnapshot: completedSnapshot(existing.id),
    });
  });

  it('claims PHONE for 10 minutes, invokes merge once, and stores only canonical resource summary', async () => {
    const source = user({ id: '3' });
    const { service, adapter, merge, state } = buildService({
      users: [source],
    });

    await service.bindWechatPhone(
      { id: source.id, phone: null, phoneVerified: false },
      'phone-code',
      NOW,
    );

    expect(state.credential).toMatchObject({
      kind: WechatCredentialKind.PHONE,
      credentialHash: hashWechatCredential('phone-code'),
      status: WechatCredentialStatus.COMPLETED,
      expiresAt: new Date(NOW.getTime() + WECHAT_CREDENTIAL_TTL_MS),
      resourceUserId: source.id,
      responseSnapshot: completedPhoneSnapshot(source.id, source.id),
    });
    expect(adapter.exchangePhoneCredential).toHaveBeenCalledOnce();
    expect(merge.withPhoneLock).toHaveBeenCalledWith(
      '13800000000',
      expect.any(Function),
    );
    expect(merge.mergeInTransaction).toHaveBeenCalledWith({
      authenticatedUserId: source.id,
      normalizedPhone: '13800000000',
    });
    expect(merge.mergeVerifiedPhone).not.toHaveBeenCalled();
    expect(state.events).toEqual(
      expect.arrayContaining([
        'vendor:outside',
        'phone-lock:transaction:start',
        'phone-lock:transaction:commit',
      ]),
    );
    expect(JSON.stringify(state.credential?.responseSnapshot)).not.toMatch(
      /13800000000|phone-code|accessToken|token-for/u,
    );
  });

  it('recovers a concurrent LOGIN unique conflict by reading the canonical active user', async () => {
    const winner = user({
      id: '7',
      wechatOpenid: 'openid-race',
      wechatUnionid: 'unionid-race',
    });
    const { service, adapter, identities, state, userRepository } =
      buildService();
    adapter.exchangeLoginCode.mockResolvedValueOnce({
      openid: 'openid-race',
      unionid: 'unionid-race',
    });
    identities.createWechatUser.mockImplementationOnce(async () => {
      state.users = [winner];
      throw Object.assign(new Error('duplicate identity'), {
        code: 'ER_DUP_ENTRY',
      });
    });

    await expect(
      service.loginWithWechatCode('race-code', NOW),
    ).resolves.toMatchObject({ profile: { id: winner.id } });
    expect(userRepository.find).toHaveBeenCalledTimes(2);
    expect(
      state.events.filter((event) => event === 'transaction:start'),
    ).toHaveLength(4);
    expect(state.users).toEqual([winner]);
  });

  it('rejects another principal reclaiming an expired PHONE claim before vendor access', async () => {
    const stale = credential({
      kind: WechatCredentialKind.PHONE,
      credentialHash: hashWechatCredential('phone-code'),
      expiresAt: new Date(NOW.getTime() - 1),
      responseSnapshot: {
        version: 2,
        kind: 'CLAIM',
        claimId: 'source-claim',
        principal: { sourceUserId: 'source-id' },
      },
    });
    const { service, adapter, merge } = buildService({ credential: stale });

    await expect(
      service.bindWechatPhone(
        { id: 'other-id', phone: null, phoneVerified: false },
        'phone-code',
        NOW,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
      }),
    });
    expect(adapter.exchangePhoneCredential).not.toHaveBeenCalled();
    expect(merge.mergeInTransaction).not.toHaveBeenCalled();
  });

  it('persists principal-bound PHONE failure, replays it only to the source, and rejects another user', async () => {
    const mergeFailure = new ConflictException({
      code: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
      message: 'User identity merge requires manual review.',
      category: 'FINANCIAL_FACTS',
      counts: { orders: 1 },
    });
    const { service, adapter, merge, state } = buildService();
    merge.mergeInTransaction.mockRejectedValueOnce(mergeFailure);

    await expect(
      service.bindWechatPhone(
        { id: 'source-id', phone: null, phoneVerified: false },
        'phone-code',
        NOW,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
      }),
    });
    expect(state.credential).toMatchObject({
      status: WechatCredentialStatus.FAILED,
      responseSnapshot: {
        version: 2,
        kind: 'FAILED',
        principal: { sourceUserId: 'source-id' },
        failureCode: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
      },
    });
    expect(JSON.stringify(state.credential?.responseSnapshot)).not.toMatch(
      /13800000000|phone-code|orders|counts/u,
    );

    await expect(
      service.bindWechatPhone(
        { id: 'source-id', phone: null, phoneVerified: false },
        'phone-code',
        NOW,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
      }),
    });
    await expect(
      service.bindWechatPhone(
        { id: 'other-id', phone: null, phoneVerified: false },
        'phone-code',
        NOW,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
      }),
    });
    expect(adapter.exchangePhoneCredential).toHaveBeenCalledTimes(1);
    expect(merge.mergeInTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: 'legacy v1',
      snapshot: failedSnapshot(ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW),
    },
    {
      label: 'malformed v2',
      snapshot: {
        version: 2,
        kind: 'FAILED',
        principal: { sourceUserId: 42 },
        failureCode: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
        internalDetail: 'must-not-leak',
      },
    },
  ])(
    'fails closed for $label PHONE FAILED snapshots without leaking or calling vendor',
    async ({ snapshot }) => {
      const failed = credential({
        kind: WechatCredentialKind.PHONE,
        credentialHash: hashWechatCredential('phone-code'),
        status: WechatCredentialStatus.FAILED,
        resourceUserId: null,
        responseSnapshot: snapshot,
      });
      const { service, adapter, merge } = buildService({ credential: failed });

      let rejection: unknown;
      try {
        await service.bindWechatPhone(
          { id: 'source-id', phone: null, phoneVerified: false },
          'phone-code',
          NOW,
        );
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toMatchObject({
        response: {
          code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
          message: 'WeChat credential has already been used.',
        },
      });
      expect(JSON.stringify(rejection)).not.toMatch(/must-not-leak/u);
      expect(adapter.exchangePhoneCredential).not.toHaveBeenCalled();
      expect(merge.mergeInTransaction).not.toHaveBeenCalled();
    },
  );

  it.each(['source-id', '8'])(
    'replays COMPLETED PHONE only for saved source/canonical principal %s',
    async (principalId) => {
      const canonical = user({
        id: '8',
        phone: '13800000000',
        phoneVerified: true,
        tokenVersion: 3,
      });
      const completed = credential({
        kind: WechatCredentialKind.PHONE,
        credentialHash: hashWechatCredential('phone-code'),
        status: WechatCredentialStatus.COMPLETED,
        resourceUserId: canonical.id,
        responseSnapshot: completedPhoneSnapshot('source-id', canonical.id),
      });
      const { service, adapter, merge } = buildService({
        credential: completed,
        users: [canonical],
      });

      await expect(
        service.bindWechatPhone(
          { id: principalId, phone: null, phoneVerified: false },
          'phone-code',
          NOW,
        ),
      ).resolves.toMatchObject({
        accessToken: 'token-for-8-3',
        profile: { id: '8', phoneVerified: true },
      });
      expect(adapter.exchangePhoneCredential).not.toHaveBeenCalled();
      expect(merge.mergeVerifiedPhone).not.toHaveBeenCalled();
      expect(merge.mergeInTransaction).not.toHaveBeenCalled();
    },
  );

  it('rejects expired COMPLETED PHONE for the saved principal without vendor, merge, session, or reclaim', async () => {
    const canonical = user({
      id: '8',
      phone: '13800000000',
      phoneVerified: true,
      tokenVersion: 3,
    });
    const completed = credential({
      kind: WechatCredentialKind.PHONE,
      credentialHash: hashWechatCredential('phone-code'),
      status: WechatCredentialStatus.COMPLETED,
      expiresAt: new Date(NOW.getTime() - 1),
      resourceUserId: canonical.id,
      responseSnapshot: completedPhoneSnapshot('source-id', canonical.id),
    });
    const { service, adapter, merge, sessions, state } = buildService({
      credential: completed,
      users: [canonical],
    });

    await expect(
      service.bindWechatPhone(
        { id: 'source-id', phone: null, phoneVerified: false },
        'phone-code',
        NOW,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
      }),
    });
    expect(adapter.exchangePhoneCredential).not.toHaveBeenCalled();
    expect(merge.mergeInTransaction).not.toHaveBeenCalled();
    expect(sessions.issueSession).not.toHaveBeenCalled();
    expect(state.credential).toMatchObject({
      status: WechatCredentialStatus.COMPLETED,
      expiresAt: new Date(NOW.getTime() - 1),
      resourceUserId: canonical.id,
      responseSnapshot: completedPhoneSnapshot('source-id', canonical.id),
    });
  });

  it('rejects COMPLETED PHONE replay by another valid mall-user without issuing a session', async () => {
    const canonical = user({
      id: '8',
      phone: '13800000000',
      phoneVerified: true,
      tokenVersion: 3,
    });
    const other = user({ id: '99', wechatOpenid: 'openid-other' });
    const completed = credential({
      kind: WechatCredentialKind.PHONE,
      credentialHash: hashWechatCredential('phone-code'),
      status: WechatCredentialStatus.COMPLETED,
      resourceUserId: canonical.id,
      responseSnapshot: completedPhoneSnapshot('source-id', canonical.id),
    });
    const { service, adapter, merge, sessions } = buildService({
      credential: completed,
      users: [canonical, other],
    });

    await expect(
      service.bindWechatPhone(
        { id: other.id, phone: null, phoneVerified: false },
        'phone-code',
        NOW,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
      }),
    });
    expect(adapter.exchangePhoneCredential).not.toHaveBeenCalled();
    expect(merge.mergeVerifiedPhone).not.toHaveBeenCalled();
    expect(sessions.issueSession).not.toHaveBeenCalled();
  });
});
