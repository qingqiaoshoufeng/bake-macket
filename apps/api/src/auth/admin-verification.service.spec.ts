import { ApiErrorCode } from '@bake-mall/contracts';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../audit/audit.service.js';
import { AdminLoginVerificationBucket } from '../database/entities/admin-login-verification-bucket.entity.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';
import {
  AdminVerificationService,
  calculateAdminLoginBucketId,
  type AdminVerificationOutcome,
  type AdminVerificationPurpose,
} from './admin-verification.service.js';

const NOW = new Date('2026-08-04T08:00:00.000Z');
const PROCESS_SKEWED_NOW = new Date('2036-08-04T08:00:00.000Z');
const PASSWORD_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
const PURPOSE: AdminVerificationPurpose = 'HIGH_RISK_ACTION';
const SECRET = 'unit-admin-secret-at-least-32-characters';

type AdminFixture = Pick<
  AdminUser,
  | 'id'
  | 'username'
  | 'passwordHash'
  | 'verifyFailedCount'
  | 'verifyWindowStartedAt'
>;

type BucketFixture = Pick<
  AdminLoginVerificationBucket,
  'bucketId' | 'failedCount' | 'windowStartedAt'
>;

type Harness = ReturnType<typeof buildHarness>;

const buildAdmin = (overrides: Partial<AdminFixture> = {}): AdminFixture => ({
  id: '41',
  username: 'admin@example.com',
  passwordHash: PASSWORD_HASH,
  verifyFailedCount: 0,
  verifyWindowStartedAt: null,
  ...overrides,
});

const buildBucket = (
  overrides: Partial<BucketFixture> = {},
): BucketFixture => ({
  bucketId: calculateAdminLoginBucketId(
    SECRET,
    'SUPER_ADMIN',
    'admin@example.com',
  ),
  failedCount: 0,
  windowStartedAt: null,
  ...overrides,
});

function buildHarness(
  initialAdmin: AdminFixture | null = buildAdmin(),
  initialBucket: BucketFixture = buildBucket(),
) {
  let persistedAdmin = initialAdmin ? { ...initialAdmin } : null;
  let persistedBucket = { ...initialBucket };
  const auditEntries: Array<Record<string, unknown>> = [];
  const adminRepository = {
    findOne: vi.fn(async () => (persistedAdmin ? { ...persistedAdmin } : null)),
    save: vi.fn(async (admin: AdminFixture) => {
      persistedAdmin = { ...admin };
      return admin;
    }),
  };
  const bucketRepository = {
    findOne: vi.fn(async ({ where }: { where: { bucketId: number } }) =>
      where.bucketId === persistedBucket.bucketId
        ? { ...persistedBucket }
        : null,
    ),
    save: vi.fn(async (bucket: BucketFixture) => {
      persistedBucket = { ...bucket };
      return bucket;
    }),
  };
  const manager = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === AdminUser) return adminRepository;
      if (entity === AdminLoginVerificationBucket) return bucketRepository;
      throw new Error(`unexpected repository ${String(entity)}`);
    }),
    query: vi.fn(async () => [{ database_now: NOW }]),
  };
  const transaction = vi.fn(
    async <T>(
      operation: (transactionManager: typeof manager) => Promise<T>,
    ) => {
      const adminSnapshot = persistedAdmin ? { ...persistedAdmin } : null;
      const bucketSnapshot = { ...persistedBucket };
      const auditLength = auditEntries.length;
      try {
        return await operation(manager);
      } catch (error) {
        persistedAdmin = adminSnapshot;
        persistedBucket = bucketSnapshot;
        auditEntries.splice(auditLength);
        throw error;
      }
    },
  );
  const audit = {
    record: vi.fn(async (entry: Record<string, unknown>) => {
      auditEntries.push(structuredClone(entry));
      return entry;
    }),
  };
  const config = {
    get: vi.fn().mockReturnValue({ JWT_ADMIN_SECRET: SECRET }),
  };
  const service = new AdminVerificationService(
    { transaction } as never,
    audit as unknown as AuditService,
    config as never,
  );

  return {
    service,
    manager,
    adminRepository,
    bucketRepository,
    audit,
    auditEntries,
    resolveKnown: vi.fn(async () =>
      persistedAdmin ? ({ ...persistedAdmin } as AdminUser) : null,
    ),
    resolveUnknown: vi.fn(async () => null),
    getAdmin: () => (persistedAdmin ? { ...persistedAdmin } : null),
    getBucket: () => ({ ...persistedBucket }),
  };
}

const verifyNonLogin = (
  harness: Harness,
  candidatePassword: string,
  now = NOW,
  purpose: AdminVerificationPurpose = PURPOSE,
) =>
  harness.service.verifyPassword({
    adminId: '41',
    candidatePassword,
    now,
    context: { purpose },
  });

const verifyPublic = (
  harness: Harness,
  candidatePassword: string,
  resolveAdmin:
    Harness['resolveKnown'] | Harness['resolveUnknown'] = harness.resolveKnown,
  now = NOW,
) =>
  harness.service.verifyPublicLogin({
    loginKind: 'SUPER_ADMIN',
    normalizedIdentifier: 'admin@example.com',
    candidatePassword,
    now,
    resolveAdmin,
  });

const responseCode = (error: unknown): unknown => {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? (response as { code?: unknown }).code
    : undefined;
};

const expectFailed = async (operation: Promise<unknown>): Promise<void> => {
  await expect(operation).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof UnauthorizedException &&
      responseCode(error) === ApiErrorCode.ADMIN_VERIFICATION_FAILED,
  );
};

const expectLimited = async (operation: Promise<unknown>): Promise<void> => {
  await expect(operation).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof HttpException &&
      error.getStatus() === 429 &&
      responseCode(error) === ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
  );
};

describe('calculateAdminLoginBucketId', () => {
  it('相同 secret、kind 与规范标识稳定映射到 0..1023', () => {
    const first = calculateAdminLoginBucketId(
      SECRET,
      'SUPER_ADMIN',
      'admin@example.com',
    );
    expect(
      calculateAdminLoginBucketId(SECRET, 'SUPER_ADMIN', 'admin@example.com'),
    ).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1024);
  });

  it('login kind 参与用途域映射', () => {
    expect(
      calculateAdminLoginBucketId(SECRET, 'SUPER_ADMIN', '13800000000'),
    ).not.toBe(calculateAdminLoginBucketId(SECRET, 'OPERATOR', '13800000000'));
  });

  it('大量标识始终落在固定 bucket 边界内', () => {
    const ids = Array.from({ length: 5000 }, (_, index) =>
      calculateAdminLoginBucketId(
        SECRET,
        index % 2 === 0 ? 'SUPER_ADMIN' : 'OPERATOR',
        `identifier-${index}`,
      ),
    );
    expect(
      ids.every((id) => Number.isInteger(id) && id >= 0 && id < 1024),
    ).toBe(true);
  });
});

describe('AdminVerificationService 公开登录', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('known 与 unknown 都是前五次 401、第六次 429，且限流时不 bcrypt', async () => {
    const known = buildHarness();
    const unknown = buildHarness(null);
    const compare = vi
      .spyOn(bcrypt, 'compare')
      .mockResolvedValue(false as never);

    for (let count = 1; count <= 5; count += 1) {
      await expectFailed(verifyPublic(known, `known-${count}`));
      await expectFailed(
        verifyPublic(unknown, `unknown-${count}`, unknown.resolveUnknown),
      );
    }
    await expectLimited(verifyPublic(known, 'known-correct-but-blocked'));
    await expectLimited(
      verifyPublic(unknown, 'unknown-6', unknown.resolveUnknown),
    );

    expect(compare).toHaveBeenCalledTimes(10);
    expect(known.getBucket()).toEqual({
      bucketId: expect.any(Number),
      failedCount: 5,
      windowStartedAt: NOW,
    });
    expect(unknown.getBucket()).toEqual({
      bucketId: expect.any(Number),
      failedCount: 5,
      windowStartedAt: NOW,
    });
  });

  it('已知身份的混合密码格式仍走真实 bcrypt，不按格式分流', async () => {
    const harness = buildHarness();
    const compare = vi
      .spyOn(bcrypt, 'compare')
      .mockResolvedValue(false as never);

    await expectFailed(verifyPublic(harness, 'legacy-letter-password'));
    await expectFailed(verifyPublic(harness, '123456'));

    expect(compare).toHaveBeenNthCalledWith(
      1,
      'legacy-letter-password',
      PASSWORD_HASH,
    );
    expect(compare).toHaveBeenNthCalledWith(2, '123456', PASSWORD_HASH);
    expect(harness.resolveKnown).toHaveBeenCalledTimes(2);
  });

  it('bucket 已限流时正确密码也 429，且不查询身份、不执行 bcrypt', async () => {
    const harness = buildHarness(
      buildAdmin(),
      buildBucket({
        failedCount: 5,
        windowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
      }),
    );
    const compare = vi
      .spyOn(bcrypt, 'compare')
      .mockResolvedValue(true as never);

    await expectLimited(verifyPublic(harness, 'correct'));

    expect(harness.resolveKnown).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
  });

  it('known 失败在同一事务同时累计 bucket 与 admin 精确窗口', async () => {
    const harness = buildHarness();
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

    await expectFailed(verifyPublic(harness, 'wrong'));

    expect(harness.getAdmin()).toMatchObject({
      verifyFailedCount: 1,
      verifyWindowStartedAt: NOW,
    });
    expect(harness.getBucket()).toEqual({
      bucketId: expect.any(Number),
      failedCount: 1,
      windowStartedAt: NOW,
    });
  });

  it('锁定 bucket 后只读一次数据库时间，并用同一时间判断和写入 bucket/admin 窗口', async () => {
    const harness = buildHarness(
      buildAdmin({
        verifyFailedCount: 5,
        verifyWindowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
      }),
      buildBucket({
        failedCount: 4,
        windowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
      }),
    );
    harness.manager.query.mockResolvedValueOnce([
      { database_now: '2026-08-04 08:00:00.000000' },
    ] as never);
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

    await expectFailed(
      verifyPublic(
        harness,
        'wrong-with-skewed-process-clock',
        harness.resolveKnown,
        PROCESS_SKEWED_NOW,
      ),
    );

    expect(harness.manager.query).toHaveBeenCalledTimes(1);
    expect(harness.manager.query).toHaveBeenCalledWith(
      expect.stringMatching(/UTC_TIMESTAMP\(6\)/i),
    );
    expect(
      harness.bucketRepository.findOne.mock.invocationCallOrder[0],
    ).toBeLessThan(harness.manager.query.mock.invocationCallOrder[0] ?? 0);
    expect(harness.resolveKnown).toHaveBeenCalledTimes(1);
    expect(harness.getAdmin()).toMatchObject({
      verifyFailedCount: 5,
      verifyWindowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
    });
    expect(harness.getBucket()).toEqual({
      bucketId: expect.any(Number),
      failedCount: 5,
      windowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
    });
  });

  it('bucket 保存失败会回滚同事务内已修改的 admin 精确窗口', async () => {
    const harness = buildHarness();
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
    harness.bucketRepository.save.mockRejectedValueOnce(
      new Error('bucket unavailable'),
    );

    await expect(verifyPublic(harness, 'wrong')).rejects.toThrow(
      'bucket unavailable',
    );

    expect(harness.getAdmin()).toMatchObject({
      verifyFailedCount: 0,
      verifyWindowStartedAt: null,
    });
    expect(harness.getBucket()).toMatchObject({ failedCount: 0 });
  });

  it('known 成功清零 admin 精确窗口但不清 bucket 失败窗口', async () => {
    const harness = buildHarness(
      buildAdmin({
        verifyFailedCount: 3,
        verifyWindowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
      }),
      buildBucket({
        failedCount: 3,
        windowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
      }),
    );
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    await expect(verifyPublic(harness, 'correct')).resolves.toMatchObject({
      status: 'VERIFIED',
      admin: { id: '41' },
    });

    expect(harness.getAdmin()).toMatchObject({
      verifyFailedCount: 0,
      verifyWindowStartedAt: null,
    });
    expect(harness.getBucket()).toEqual({
      bucketId: expect.any(Number),
      failedCount: 3,
      windowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
    });
  });

  it('admin 精确窗口已满但 bucket 新鲜时 known 与 unknown 都先返回 401', async () => {
    const known = buildHarness(
      buildAdmin({
        verifyFailedCount: 5,
        verifyWindowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
      }),
    );
    const unknown = buildHarness(null);
    const compare = vi
      .spyOn(bcrypt, 'compare')
      .mockResolvedValue(false as never);

    for (let count = 1; count <= 5; count += 1) {
      await expectFailed(verifyPublic(known, `known-${count}`));
      await expectFailed(
        verifyPublic(unknown, `unknown-${count}`, unknown.resolveUnknown),
      );
    }
    await expectLimited(verifyPublic(known, 'correct'));
    await expectLimited(
      verifyPublic(unknown, 'unknown-6', unknown.resolveUnknown),
    );

    expect(compare).toHaveBeenCalledTimes(10);
    expect(compare.mock.calls[0]?.[1]).not.toBe(PASSWORD_HASH);
    expect(known.getAdmin()).toMatchObject({
      verifyFailedCount: 5,
      verifyWindowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
    });
    expect(known.getBucket()).toEqual({
      bucketId: expect.any(Number),
      failedCount: 5,
      windowStartedAt: NOW,
    });
    expect(unknown.getBucket()).toEqual({
      bucketId: expect.any(Number),
      failedCount: 5,
      windowStartedAt: NOW,
    });
  });

  it('公开登录只更新固定 bucket 聚合，不新增 AuditLog 明细', async () => {
    const harness = buildHarness();
    vi.spyOn(bcrypt, 'compare')
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(true as never);

    await expectFailed(verifyPublic(harness, 'wrong'));
    await verifyPublic(harness, 'correct');

    expect(harness.audit.record).not.toHaveBeenCalled();
    expect(harness.auditEntries).toEqual([]);
  });
});

describe('AdminVerificationService 非公开验证', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('非 LOGIN purpose 继续使用精确 admin 窗口并写 AuditLog', async () => {
    const harness = buildHarness();
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

    await expectFailed(verifyNonLogin(harness, 'wrong'));

    expect(harness.getAdmin()).toMatchObject({ verifyFailedCount: 1 });
    expect(harness.getBucket()).toMatchObject({ failedCount: 0 });
    expect(harness.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'ADMIN', adminUserId: '41' },
        action: 'ADMIN_PASSWORD_VERIFICATION',
        changeSummary: expect.objectContaining({
          purpose: PURPOSE,
          result: 'FAILED',
        }),
      }),
      harness.manager,
    );
  });

  it('已认证精确窗口前五次失败、第六次 429，并逐次写脱敏 AuditLog', async () => {
    const harness = buildHarness();
    const candidates = Array.from(
      { length: 6 },
      (_, index) => `sensitive-wrong-password-${index + 1}`,
    );
    const compare = vi
      .spyOn(bcrypt, 'compare')
      .mockResolvedValue(false as never);

    for (const candidate of candidates.slice(0, 5)) {
      await expectFailed(verifyNonLogin(harness, candidate));
    }
    await expectLimited(verifyNonLogin(harness, candidates[5]));

    expect(compare).toHaveBeenCalledTimes(5);
    expect(harness.getAdmin()).toMatchObject({
      verifyFailedCount: 5,
      verifyWindowStartedAt: NOW,
    });
    expect(harness.auditEntries).toEqual(
      [1, 2, 3, 4, 5, 5].map((count, index) => ({
        actor: { type: 'ADMIN', adminUserId: '41' },
        targetEntity: 'admin_users',
        targetId: '41',
        action: 'ADMIN_PASSWORD_VERIFICATION',
        changeSummary: {
          count,
          purpose: PURPOSE,
          result: index < 5 ? 'FAILED' : 'RATE_LIMITED',
          windowStartedAt: NOW,
        },
      })),
    );
    const serializedAudit = JSON.stringify(harness.auditEntries);
    for (const sensitive of [
      ...candidates,
      PASSWORD_HASH,
      'admin@example.com',
    ]) {
      expect(serializedAudit).not.toContain(sensitive);
    }
    expect(serializedAudit).not.toMatch(
      /candidatePassword|passwordHash|normalizedIdentifier/iu,
    );
  });

  it('已认证精确窗口过期后从一次失败和新窗口重新计数', async () => {
    const harness = buildHarness(
      buildAdmin({
        verifyFailedCount: 5,
        verifyWindowStartedAt: new Date('2026-08-04T07:54:59.999Z'),
      }),
    );
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

    await expectFailed(verifyNonLogin(harness, 'wrong-after-expiry'));

    expect(harness.getAdmin()).toMatchObject({
      verifyFailedCount: 1,
      verifyWindowStartedAt: NOW,
    });
    expect(harness.auditEntries).toEqual([
      expect.objectContaining({
        changeSummary: {
          count: 1,
          purpose: PURPOSE,
          result: 'FAILED',
          windowStartedAt: NOW,
        },
      }),
    ]);
  });

  it('已认证验证在锁定 admin 后用数据库时间而非调用进程时间判断窗口', async () => {
    const harness = buildHarness(
      buildAdmin({
        verifyFailedCount: 4,
        verifyWindowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
      }),
    );
    harness.manager.query.mockResolvedValueOnce([{ database_now: NOW }]);
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

    await expectFailed(
      verifyNonLogin(
        harness,
        'wrong-with-skewed-process-clock',
        PROCESS_SKEWED_NOW,
      ),
    );

    expect(
      harness.adminRepository.findOne.mock.invocationCallOrder[0],
    ).toBeLessThan(harness.manager.query.mock.invocationCallOrder[0] ?? 0);
    expect(harness.manager.query).toHaveBeenCalledTimes(1);
    expect(harness.getAdmin()).toMatchObject({
      verifyFailedCount: 5,
      verifyWindowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
    });
  });

  it('INITIAL_PASSWORD_CHANGE 成功清零精确窗口并写脱敏成功 AuditLog', async () => {
    const harness = buildHarness(
      buildAdmin({
        verifyFailedCount: 4,
        verifyWindowStartedAt: new Date('2026-08-04T07:59:00.000Z'),
      }),
    );
    const candidate = 'sensitive-initial-password';
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    await expect(
      verifyNonLogin(harness, candidate, NOW, 'INITIAL_PASSWORD_CHANGE'),
    ).resolves.toMatchObject({ status: 'VERIFIED', admin: { id: '41' } });

    expect(harness.getAdmin()).toMatchObject({
      verifyFailedCount: 0,
      verifyWindowStartedAt: null,
    });
    expect(harness.auditEntries).toEqual([
      {
        actor: { type: 'ADMIN', adminUserId: '41' },
        targetEntity: 'admin_users',
        targetId: '41',
        action: 'ADMIN_PASSWORD_VERIFICATION',
        changeSummary: {
          count: 0,
          purpose: 'INITIAL_PASSWORD_CHANGE',
          result: 'VERIFIED',
          windowStartedAt: null,
        },
      },
    ]);
    expect(JSON.stringify(harness.auditEntries)).not.toContain(candidate);
    expect(JSON.stringify(harness.auditEntries)).not.toContain(PASSWORD_HASH);
  });

  it('事务内 API 继续返回可辨识 outcome，供调用方提交后处理', async () => {
    const harness = buildHarness();
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

    const outcome: AdminVerificationOutcome =
      await harness.service.verifyInTransaction(harness.manager as never, {
        adminId: '41',
        candidatePassword: 'wrong',
        now: NOW,
        context: { purpose: 'PASSWORD_CHANGE' },
      });

    expect(outcome).toEqual({
      status: 'FAILED',
      count: 1,
      windowStartedAt: NOW,
    });
  });

  it('旧 verifyPassword LOGIN 绕过路径在运行时 fail closed', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.verifyPassword({
        adminId: '41',
        candidatePassword: 'correct',
        now: NOW,
        context: { purpose: 'LOGIN' },
      } as never),
    ).rejects.toThrow(/public login|公开登录/i);

    expect(harness.adminRepository.findOne).not.toHaveBeenCalled();
    expect(harness.audit.record).not.toHaveBeenCalled();
  });
});
