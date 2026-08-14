import { ApiErrorCode } from '@bake-mall/contracts';
import { createHash, createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { AdminOperationIdempotency } from '../database/entities/admin-operation-idempotency.entity.js';
import {
  ADMIN_OPERATION_STALE_AGE_MS,
  AdminOperationIdempotencyService,
} from './admin-operation-idempotency.service.js';

type RecordFixture = Record<string, unknown>;

const matches = (
  record: RecordFixture,
  where: Readonly<Record<string, unknown>>,
): boolean =>
  Object.entries(where).every(([key, value]) => {
    const operator = value as
      { _type?: string; _value?: unknown } | null | undefined;
    if (operator?._type === 'lessThanOrEqual') {
      const actual = record[key];
      return (
        actual instanceof Date &&
        operator._value instanceof Date &&
        actual.getTime() <= operator._value.getTime()
      );
    }
    return record[key] === value;
  });

const TEST_ADMIN_JWT_SECRET = 'test-admin-jwt-secret-at-least-32';
const TEST_IDEMPOTENCY_SECRET =
  'test-admin-operation-idempotency-secret-at-least-32';

const buildHarness = (
  initialRecords: readonly RecordFixture[] = [],
  idempotencySecret = TEST_IDEMPOTENCY_SECRET,
  adminJwtSecret = TEST_ADMIN_JWT_SECRET,
) => {
  const records = initialRecords.map((record) => ({ ...record }));
  const repository = {
    insert: vi.fn(async (value: RecordFixture) => {
      const duplicate = records.some(
        (record) =>
          record.adminId === value.adminId &&
          record.operation === value.operation &&
          record.key === value.key,
      );
      if (duplicate) {
        throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      }
      const id = String(records.length + 1);
      records.push({ id, ...value });
      return { identifiers: [{ id }] };
    }),
    findOne: vi.fn(
      async ({ where }: { where: Readonly<Record<string, unknown>> }) => {
        const record = records.find((candidate) => matches(candidate, where));
        return record ? { ...record } : null;
      },
    ),
    update: vi.fn(
      async (
        where: Readonly<Record<string, unknown>>,
        values: Readonly<Record<string, unknown>>,
      ) => {
        const matching = records.filter((record) => matches(record, where));
        matching.forEach((record) => Object.assign(record, values));
        return { affected: matching.length };
      },
    ),
  };
  const manager = {
    getRepository: vi.fn((entity: unknown) => {
      expect(entity).toBe(AdminOperationIdempotency);
      return repository;
    }),
  };
  return {
    records,
    repository,
    manager,
    service: new AdminOperationIdempotencyService(
      repository as never,
      {
        get: vi.fn().mockReturnValue({
          JWT_ADMIN_SECRET: adminJwtSecret,
          ADMIN_OPERATION_IDEMPOTENCY_SECRET: idempotencySecret,
        }),
      } as never,
    ),
  };
};

const IDEMPOTENCY_KEY_1 = '00000000-0000-4000-8000-000000000001';

const claimInput = {
  adminId: 'admin-1',
  operation: 'CLOUD_PRINTER_BIND',
  key: IDEMPOTENCY_KEY_1,
  request: { displayName: '前台', serialNumber: 'SN-123' },
} as const;

const expectApiCode = (code: ApiErrorCode) =>
  expect.objectContaining({
    response: expect.objectContaining({ code }),
  });

describe('AdminOperationIdempotencyService canonical request', () => {
  it('对对象键稳定排序并递归处理，同时保留数组语义顺序', () => {
    const service = buildHarness().service;

    expect(
      service.hashRequest({ z: 1, nested: { b: 2, a: 1 }, items: ['b', 'a'] }),
    ).toBe(
      service.hashRequest({ items: ['b', 'a'], nested: { a: 1, b: 2 }, z: 1 }),
    );
    expect(service.hashRequest({ items: ['a', 'b'] })).not.toBe(
      service.hashRequest({ items: ['b', 'a'] }),
    );
  });

  it('对 operationPassword 使用服务端密钥 HMAC，不把裸密码 SHA-256 写入 hash', () => {
    const service = buildHarness().service;
    const password = 'recovery-password';
    const request = { printerId: 'printer-1', operationPassword: password };

    expect(service.hashRequest(request)).not.toBe(
      createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    );
    expect(service.hashRequest(request)).not.toBe(
      createHash('sha256').update(password).digest('hex'),
    );
    expect(service.hashRequest(request)).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            operationPassword: createHmac('sha256', TEST_IDEMPOTENCY_SECRET)
              .update(JSON.stringify(password))
              .digest('hex'),
            printerId: 'printer-1',
          }),
        )
        .digest('hex'),
    );
    expect(
      service.hashRequest({ ...request, operationPassword: 'different' }),
    ).not.toBe(service.hashRequest(request));
  });

  it('admin JWT secret 轮换但专用 secret 不变时保持敏感请求 hash 稳定', () => {
    const request = {
      printerId: 'printer-1',
      operationPassword: 'recovery-password',
    };
    const beforeJwtRotation = buildHarness(
      [],
      TEST_IDEMPOTENCY_SECRET,
      'admin-jwt-secret-before-rotation-at-least-32',
    ).service;
    const afterJwtRotation = buildHarness(
      [],
      TEST_IDEMPOTENCY_SECRET,
      'admin-jwt-secret-after-rotation-at-least-32',
    ).service;

    expect(beforeJwtRotation.hashRequest(request)).toBe(
      afterJwtRotation.hashRequest(request),
    );
  });

  it('专用 secret 变化时敏感请求 hash 变化', () => {
    const request = {
      printerId: 'printer-1',
      operationPassword: 'recovery-password',
    };
    const oldSecretService = buildHarness(
      [],
      'old-idempotency-secret-at-least-32-characters',
    ).service;
    const newSecretService = buildHarness(
      [],
      'new-idempotency-secret-at-least-32-characters',
    ).service;

    expect(oldSecretService.hashRequest(request)).not.toBe(
      newSecretService.hashRequest(request),
    );
  });

  it('使用严格 UTF-16 键顺序，使规范等价对象不受插入顺序影响', () => {
    const service = buildHarness().service;
    const composed = 'é';
    const decomposed = 'é';

    expect(service.hashRequest({ [composed]: 1, [decomposed]: 2 })).toBe(
      service.hashRequest({ [decomposed]: 2, [composed]: 1 }),
    );
  });

  it.each([
    ['root undefined', undefined],
    ['nested undefined', { value: undefined }],
    ['array undefined', [1, undefined]],
    ['sparse array', Array(1)],
    ['NaN', { value: Number.NaN }],
    ['Infinity', { value: Number.POSITIVE_INFINITY }],
    ['bigint', { value: 1n }],
    ['date', { value: new Date('2026-08-04T00:00:00.000Z') }],
  ])('拒绝 %s 非 JSON 请求值', (_case, request) => {
    expect(() => buildHarness().service.hashRequest(request)).toThrow(
      /canonical|JSON/iu,
    );
  });

  it('拒绝循环引用', () => {
    const request: Record<string, unknown> = {};
    request.self = request;

    expect(() => buildHarness().service.hashRequest(request)).toThrow(
      /cycle|循环/iu,
    );
  });

  it.each([
    ['prototype pollution key', JSON.parse('{"__proto__":{"polluted":true}}')],
    ['constructor key', { nested: { constructor: 'pollute' } }],
    ['symbol key', { [Symbol('hidden')]: 'value' }],
  ])('拒绝 %s，避免规范化碰撞或原型污染', (_case, request) => {
    expect(() => buildHarness().service.hashRequest(request)).toThrow(
      /prototype|pollution|symbol|JSON|canonical/iu,
    );
  });
});

describe('AdminOperationIdempotencyService preflight lookup', () => {
  it('returns ABSENT without inserting a durable owner', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.lookup(harness.manager as never, claimInput),
    ).resolves.toEqual({ kind: 'ABSENT' });
    expect(harness.repository.insert).not.toHaveBeenCalled();
    expect(harness.records).toHaveLength(0);
  });

  it('returns terminal replay before a caller performs secondary verification', async () => {
    const service = buildHarness().service;
    const snapshot = { printerId: 'printer-1', outcome: 'COMPLETED' };
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash: service.hashRequest(claimInput.request),
        status: 'COMPLETED',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: snapshot,
      },
    ]);

    await expect(
      harness.service.lookup(harness.manager as never, claimInput),
    ).resolves.toEqual({
      kind: 'REPLAY',
      status: 'COMPLETED',
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
      responseSnapshot: snapshot,
    });
    expect(harness.repository.insert).not.toHaveBeenCalled();
  });

  it('rejects a different hash before a caller verifies its password', async () => {
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash: 'f'.repeat(64),
        status: 'COMPLETED',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: { printerId: 'printer-1', outcome: 'COMPLETED' },
      },
    ]);

    await expect(
      harness.service.lookup(harness.manager as never, claimInput),
    ).rejects.toMatchObject(expectApiCode(ApiErrorCode.IDEMPOTENCY_CONFLICT));
    expect(harness.repository.insert).not.toHaveBeenCalled();
  });
});

describe('AdminOperationIdempotencyService claim and replay', () => {
  it.each([
    ['empty adminId', { adminId: '' }],
    ['blank adminId', { adminId: '   ' }],
    ['empty operation', { operation: '' }],
    ['blank operation', { operation: '   ' }],
    ['oversized operation', { operation: 'O'.repeat(65) }],
    ['invalid operation characters', { operation: 'cloud printer bind' }],
    ['empty key', { key: '' }],
    ['blank key', { key: '   ' }],
    ['non-UUID key', { key: 'key-1' }],
    ['uppercase UUID key', { key: '00000000-0000-4000-8000-00000000000A' }],
    ['UUID key with surrounding whitespace', { key: ` ${IDEMPOTENCY_KEY_1} ` }],
    ['non-v4 UUID key', { key: '00000000-0000-1000-8000-000000000001' }],
    [
      'invalid variant UUID key',
      { key: '00000000-0000-4000-7000-000000000001' },
    ],
  ])('在访问 repository 前拒绝 %s', async (_case, override) => {
    const harness = buildHarness();

    await expect(
      harness.service.claim(harness.manager as never, {
        ...claimInput,
        ...override,
      }),
    ).rejects.toThrow(/admin|operation|key|length|invalid|不能为空/iu);
    expect(harness.repository.insert).not.toHaveBeenCalled();
  });

  it('以 admin + operation + key claim，并返回唯一 owner', async () => {
    const harness = buildHarness();

    const result = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );

    expect(result).toMatchObject({
      kind: 'OWNER',
      owner: {
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(harness.records).toHaveLength(1);
    expect(harness.records[0]).toMatchObject({
      adminId: claimInput.adminId,
      operation: claimInput.operation,
      key: claimInput.key,
      status: 'IN_PROGRESS',
    });
  });

  it('相同 operation/key 在不同管理员 scope 下保持独立 owner', async () => {
    const harness = buildHarness();

    const first = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    const second = await harness.service.claim(harness.manager as never, {
      ...claimInput,
      adminId: 'admin-2',
    });

    expect(first.kind).toBe('OWNER');
    expect(second.kind).toBe('OWNER');
    expect(harness.records).toHaveLength(2);
    expect(harness.records.map(({ adminId }) => adminId)).toEqual([
      'admin-1',
      'admin-2',
    ]);
  });

  it('并发 claim 只有一个 owner，另一个得到共享处理中错误', async () => {
    const harness = buildHarness();

    const outcomes = await Promise.allSettled([
      harness.service.claim(harness.manager as never, claimInput),
      harness.service.claim(harness.manager as never, claimInput),
    ]);

    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      reason: expectApiCode(ApiErrorCode.IDEMPOTENCY_IN_PROGRESS),
    });
    expect(harness.records).toHaveLength(1);
  });

  it.each(['COMPLETED', 'FAILED'] as const)(
    '同 key/hash 的 %s 稳定重放 snapshot，不成为 owner',
    async (status) => {
      const service = buildHarness().service;
      const requestHash = service.hashRequest(claimInput.request);
      const snapshot = { printerId: 'printer-1', outcome: status };
      const harness = buildHarness([
        {
          id: 'record-1',
          adminId: claimInput.adminId,
          operation: claimInput.operation,
          key: claimInput.key,
          requestHash,
          status,
          resourceType: 'CLOUD_PRINTER',
          resourceId: 'printer-1',
          responseSnapshot: snapshot,
        },
      ]);

      await expect(
        harness.service.claim(harness.manager as never, claimInput),
      ).resolves.toEqual({
        kind: 'REPLAY',
        status,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: snapshot,
      });
    },
  );

  it('FAILED 可稳定重放 nullable resource identity 与 snapshot', async () => {
    const service = buildHarness().service;
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash: service.hashRequest(claimInput.request),
        status: 'FAILED',
        resourceType: null,
        resourceId: null,
        responseSnapshot: null,
      },
    ]);

    await expect(
      harness.service.claim(harness.manager as never, claimInput),
    ).resolves.toEqual({
      kind: 'REPLAY',
      status: 'FAILED',
      resourceType: null,
      resourceId: null,
      responseSnapshot: null,
    });
  });

  it('同 scope 不同 hash 返回冲突', async () => {
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash: 'different-hash',
        status: 'COMPLETED',
      },
    ]);

    await expect(
      harness.service.claim(harness.manager as never, claimInput),
    ).rejects.toMatchObject(expectApiCode(ApiErrorCode.IDEMPOTENCY_CONFLICT));
  });

  it.each([
    {
      name: 'malformed terminal snapshot',
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
      responseSnapshot: 'not-an-object',
    },
    {
      name: 'terminal snapshot resourceId mismatch',
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
      responseSnapshot: { printerId: 'printer-2' },
    },
    {
      name: 'terminal snapshot resourceType without resourceId',
      resourceType: 'CLOUD_PRINTER',
      resourceId: null,
      responseSnapshot: { outcome: 'FAILED' },
    },
  ])('对 $name fail closed，不返回持久化脏数据', async (fixture) => {
    const service = buildHarness().service;
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash: service.hashRequest(claimInput.request),
        status: 'COMPLETED',
        ...fixture,
      },
    ]);

    await expect(
      harness.service.claim(harness.manager as never, claimInput),
    ).rejects.toThrow(/snapshot|resource|persisted|corrupt|一致/iu);
  });

  it('UNKNOWN 不重放也不重新 claim，要求显式 reconcile', async () => {
    const service = buildHarness().service;
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash: service.hashRequest(claimInput.request),
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: null,
      },
    ]);

    await expect(
      harness.service.claim(harness.manager as never, claimInput),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );
    expect(harness.records[0]?.status).toBe('UNKNOWN');
  });

  it('findUnknownForResource 只读定位同管理员/operation/resource 的待收敛记录', async () => {
    const service = buildHarness().service;
    const requestHash = service.hashRequest(claimInput.request);
    const responseSnapshot = {
      printerId: 'printer-1',
      bindingOperationId: 'binding-cycle-1',
      version: 7,
    };
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: 'CLOUD_PRINTER_REFRESH_ONLINE',
        key: claimInput.key,
        requestHash,
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot,
      },
    ]);

    await expect(
      harness.service.findUnknownForResource(harness.manager as never, {
        adminId: claimInput.adminId,
        operation: 'CLOUD_PRINTER_REFRESH_ONLINE',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
      }),
    ).resolves.toMatchObject({
      kind: 'UNKNOWN',
      identity: { id: 'record-1', key: claimInput.key, requestHash },
      responseSnapshot,
    });
    expect(harness.repository.update).not.toHaveBeenCalled();
  });

  it('claimOrReconcileUnknown 只读返回自身 UNKNOWN identity，且不执行 mutation callback', async () => {
    const service = buildHarness().service;
    const requestHash = service.hashRequest(claimInput.request);
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash,
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: null,
      },
    ]);
    const mutation = vi.fn();

    await expect(
      harness.service.claimOrReconcileUnknown(
        harness.manager as never,
        claimInput,
      ),
    ).resolves.toEqual({
      kind: 'UNKNOWN',
      identity: {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash,
      },
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
      responseSnapshot: null,
    });
    expect(mutation).not.toHaveBeenCalled();
    expect(harness.records[0]?.status).toBe('UNKNOWN');
  });

  it('claimOrReconcileUnknown 返回安全持久化的 UNKNOWN server context snapshot', async () => {
    const service = buildHarness().service;
    const requestHash = service.hashRequest(claimInput.request);
    const responseSnapshot = {
      printerId: 'printer-1',
      bindingOperationId: 'binding-cycle-1',
    };
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash,
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot,
      },
    ]);

    await expect(
      harness.service.claimOrReconcileUnknown(
        harness.manager as never,
        claimInput,
      ),
    ).resolves.toMatchObject({
      kind: 'UNKNOWN',
      responseSnapshot,
    });
  });

  it('claimOrReconcileUnknown 保持 hash conflict、terminal replay 与 IN_PROGRESS 语义', async () => {
    const service = buildHarness().service;
    const requestHash = service.hashRequest(claimInput.request);
    const completed = buildHarness([
      {
        id: 'completed',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash,
        status: 'COMPLETED',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: { printerId: 'printer-1' },
      },
    ]);
    await expect(
      completed.service.claimOrReconcileUnknown(
        completed.manager as never,
        claimInput,
      ),
    ).resolves.toMatchObject({ kind: 'REPLAY', status: 'COMPLETED' });

    const inFlight = buildHarness([
      {
        id: 'in-progress',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash,
        status: 'IN_PROGRESS',
      },
    ]);
    await expect(
      inFlight.service.claimOrReconcileUnknown(
        inFlight.manager as never,
        claimInput,
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_IN_PROGRESS),
    );

    const conflictHarness = buildHarness([
      {
        id: 'conflict',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash: 'different-hash',
        status: 'UNKNOWN',
      },
    ]);
    await expect(
      conflictHarness.service.claimOrReconcileUnknown(
        conflictHarness.manager as never,
        claimInput,
      ),
    ).rejects.toMatchObject(expectApiCode(ApiErrorCode.IDEMPOTENCY_CONFLICT));
  });
});

describe('AdminOperationIdempotencyService owner transitions', () => {
  it('伪造 owner 即使知道 scope/hash 也不能推进其他 claim', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');

    await expect(
      harness.service.complete(harness.manager as never, {
        owner: { ...claimed.owner },
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: { printerId: 'printer-1' },
        sensitiveValues: [],
      }),
    ).rejects.toThrow(/owner|capability|transition/iu);
    expect(harness.records[0]?.status).toBe('IN_PROGRESS');
  });

  it.each([
    ['complete', 'COMPLETED'],
    ['fail', 'FAILED'],
  ] as const)('%s 仅条件更新对应 IN_PROGRESS owner', async (method, status) => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    expect(claimed.kind).toBe('OWNER');
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');
    const transition = {
      owner: claimed.owner,
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
      responseSnapshot: { printerId: 'printer-1', outcome: status },
      sensitiveValues: [],
    };

    await harness.service[method](harness.manager as never, transition);

    expect(harness.records[0]).toMatchObject({
      status,
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
      responseSnapshot: transition.responseSnapshot,
    });
    await expect(
      harness.service[method](harness.manager as never, transition),
    ).rejects.toThrow(/owner|状态|transition/iu);
  });

  it('允许不含 payload/PII 的 print batch 稳定响应 snapshot', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(harness.manager as never, {
      adminId: 'admin-1',
      operation: 'PRINT_BATCH_PROCESS',
      key: IDEMPOTENCY_KEY_1,
      request: { batchId: '7' },
    });
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');
    const responseSnapshot = {
      batch: {
        id: '7',
        printerId: '4',
        createdByAdminId: 'admin-1',
        status: 'COMPLETED',
        leaseOwner: null,
        leaseExpiresAt: null,
        totalCount: 1,
        classifiedCount: 1,
        pendingCount: 0,
        submittingCount: 0,
        acceptedCount: 1,
        failedCount: 0,
        unknownCount: 0,
        manualReviewCount: 0,
        manuallyResolvedCount: 0,
        cancelledCount: 0,
        createdAt: '2026-08-11T01:00:00.000Z',
        updatedAt: '2026-08-11T01:01:00.000Z',
      },
      processedCount: 1,
      accepted: 1,
      failed: 0,
      unknown: 0,
      manualReview: 0,
    };

    await expect(
      harness.service.complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'PRINT_BATCH',
        resourceId: '7',
        responseSnapshot,
        sensitiveValues: [],
      }),
    ).resolves.toBeUndefined();
    expect(harness.records[0]).toMatchObject({
      status: 'COMPLETED',
      responseSnapshot,
    });
  });

  it('拒绝 PRINT_BATCH snapshot 的嵌套 batch.id 与 resourceId 不一致', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(harness.manager as never, {
      adminId: 'admin-1',
      operation: 'PRINT_BATCH_PROCESS',
      key: IDEMPOTENCY_KEY_1,
      request: { batchId: '7' },
    });
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');

    await expect(
      harness.service.complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'PRINT_BATCH',
        resourceId: '7',
        responseSnapshot: {
          batch: {
            id: '8',
            printerId: '4',
            status: 'COMPLETED',
          },
        },
        sensitiveValues: [],
      }),
    ).rejects.toThrow(/resource|inconsistent|一致/iu);
    expect(harness.records[0]?.status).toBe('IN_PROGRESS');
  });

  it('owner 可在外部成功但本地完成不确定时条件标记 UNKNOWN 并持久化安全 server context', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');
    const responseSnapshot = {
      printerId: 'printer-1',
      bindingOperationId: 'binding-cycle-1',
    };

    await harness.service.markUnknown(harness.manager as never, {
      owner: claimed.owner,
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
      responseSnapshot,
      sensitiveValues: [],
    });

    expect(harness.records[0]).toMatchObject({
      status: 'UNKNOWN',
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
      responseSnapshot,
    });
  });

  it.each([
    {
      name: '深层敏感 key',
      snapshot: { nested: { operationPassword: 'not-allowed' } },
      sensitiveValues: [],
    },
    {
      name: '深层完整 serial key',
      snapshot: { nested: { serial_number: 'SN-FULL-123' } },
      sensitiveValues: [],
    },
    {
      name: '深层完整 serial value',
      snapshot: { nested: { message: 'printer SN-FULL-123 bound' } },
      sensitiveValues: ['SN-FULL-123'],
    },
    {
      name: '深层 credential/token value',
      snapshot: { items: [{ detail: 'prefix top-secret-token suffix' }] },
      sensitiveValues: ['top-secret-token'],
    },
    {
      name: '深层 authorization key',
      snapshot: { printer: { authorization: 'Basic abc' } },
      sensitiveValues: [],
    },
    {
      name: '深层 sign key',
      snapshot: { printer: { sign: 'vendor-signature' } },
      sensitiveValues: [],
    },
    {
      name: '深层 requestHash key',
      snapshot: { printer: { requestHash: 'a'.repeat(64) } },
      sensitiveValues: [],
    },
    {
      name: '深层 challenge plaintext key',
      snapshot: { printer: { challengePlaintext: '123456' } },
      sensitiveValues: [],
    },
    {
      name: '非 allowlist sn key',
      snapshot: { sn: 'SN' },
      sensitiveValues: [],
    },
    {
      name: '非 allowlist detail key',
      snapshot: { detail: 'SN' },
      sensitiveValues: [],
    },
    {
      name: '非 allowlist 通用 value key',
      snapshot: { value: 'password' },
      sensitiveValues: [],
    },
  ])('拒绝 snapshot 中的 $name', async ({ snapshot, sensitiveValues }) => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');

    const rejection = await harness.service
      .complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: snapshot,
        sensitiveValues,
      })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toMatch(/sensitive|allowlist|敏感/u);
    for (const sensitiveValue of sensitiveValues) {
      expect((rejection as Error).message).not.toContain(sensitiveValue);
    }
    expect(harness.records[0]?.status).toBe('IN_PROGRESS');
    expect(harness.records[0]?.responseSnapshot).toBeNull();
  });

  it('complete/fail/reconcile 都要求相同严格 snapshot allowlist', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');
    const unsafe = { detail: 'SN' };

    await expect(
      harness.service.fail(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: unsafe,
        sensitiveValues: [],
      }),
    ).rejects.toThrow(/allowlist|snapshot|sensitive/iu);
  });

  it.each([
    ['resource type is blank', { resourceType: ' ' }],
    ['resource type is oversized', { resourceType: 'R'.repeat(65) }],
    ['resource id is blank', { resourceId: ' ' }],
    ['resource id is oversized', { resourceId: 'I'.repeat(65) }],
    [
      'snapshot resource id differs',
      { resourceId: 'printer-1', responseSnapshot: { printerId: 'printer-2' } },
    ],
  ])('拒绝不一致的终态 resource：%s', async (_case, override) => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');

    await expect(
      harness.service.complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: { printerId: 'printer-1' },
        sensitiveValues: [],
        ...override,
      }),
    ).rejects.toThrow(/resource|length|snapshot|一致/iu);
    expect(harness.records[0]?.status).toBe('IN_PROGRESS');
  });

  it('snapshot 序列化后与后续调用方变更隔离', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');
    const snapshot = { printer: { id: 'printer-1', status: 'ACTIVE' } };

    await harness.service.complete(harness.manager as never, {
      owner: claimed.owner,
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
      responseSnapshot: snapshot,
      sensitiveValues: [],
    });
    snapshot.printer.status = 'ERROR';

    expect(harness.records[0]?.responseSnapshot).toEqual({
      printer: { id: 'printer-1', status: 'ACTIVE' },
    });
  });

  it('允许普通展示文本包含 token、secret、password 字样', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');

    await expect(
      harness.service.complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: {
          printerId: 'printer-1',
          displayName: 'Token Bakery',
          message: 'Secret Garden password workshop',
        },
        sensitiveValues: [],
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['A', 'ACTIVE'],
    ['IN', 'PENDING_VERIFICATION'],
  ])('短 SN %s 不会因状态 %s 中的子串而误报', async (serial, status) => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');

    await expect(
      harness.service.complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: {
          printer: { id: 'printer-1', status },
        },
        sensitiveValues: [serial, serial, ''],
      }),
    ).resolves.toBeUndefined();
  });

  it('长度恰好 4 的敏感值不会因 ISO 时间或普通文本中的子串而误报', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');

    await expect(
      harness.service.complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: {
          printerId: 'printer-1',
          challenge: { expiresAt: '2026-08-08T08:15:00.000Z' },
          message: 'Printer prepared in 2026',
        },
        sensitiveValues: ['2026'],
      }),
    ).resolves.toBeUndefined();
  });

  it.each(['A', 'IN', '2026'])(
    '完整 leaf 等于短敏感值 %s 时仍拒绝',
    async (serial) => {
      const harness = buildHarness();
      const claimed = await harness.service.claim(
        harness.manager as never,
        claimInput,
      );
      if (claimed.kind !== 'OWNER') throw new Error('owner expected');

      await expect(
        harness.service.complete(harness.manager as never, {
          owner: claimed.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: 'printer-1',
          responseSnapshot: {
            printerId: 'printer-1',
            items: [serial],
          },
          sensitiveValues: [serial],
        }),
      ).rejects.toThrow('response snapshot contains sensitive value');
    },
  );

  it('数组元素也继承敏感值检查，不能绕过完整 SN 防护', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');

    await expect(
      harness.service.complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: {
          printerId: 'printer-1',
          items: ['SN-FULL-123'],
        },
        sensitiveValues: ['SN-FULL-123'],
      }),
    ).rejects.toThrow(/sensitive|敏感/u);
  });

  it('长敏感值嵌入自由文本时仍拒绝且错误消息不泄漏真实值', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');
    const serial = 'SN-FULL-123';

    const rejection = await harness.service
      .complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: {
          printerId: 'printer-1',
          displayName: `Kitchen ${serial} printer`,
        },
        sensitiveValues: [serial, serial],
      })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      'response snapshot contains sensitive value',
    );
    expect((rejection as Error).message).not.toContain(serial);
  });

  it('允许脱敏 serial 字段和值写入稳定 snapshot', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');

    await expect(
      harness.service.complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: { serialNumberMasked: 'SN****23' },
        sensitiveValues: ['SN-FULL-123'],
      }),
    ).resolves.toBeUndefined();
  });
});

describe('AdminOperationIdempotencyService UNKNOWN reconciliation', () => {
  it('仅对 UNKNOWN 调用 operation-specific callback 并写入稳定终态', async () => {
    const service = buildHarness().service;
    const requestHash = service.hashRequest(claimInput.request);
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash,
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: null,
      },
    ]);
    const reconcile = vi.fn(async (context: Record<string, unknown>) => {
      expect(harness.repository.findOne).toHaveBeenCalled();
      expect(harness.repository.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'UNKNOWN' }),
        expect.objectContaining({ status: 'IN_PROGRESS' }),
      );
      expect(context).toMatchObject({
        operation: claimInput.operation,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
      });
      return {
        status: 'COMPLETED' as const,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: { printerId: 'printer-1', reconciled: true },
      };
    });

    await expect(
      harness.service.reconcileUnknown(harness.manager as never, {
        ...claimInput,
        sensitiveValues: [],
        reconcile,
      }),
    ).resolves.toEqual({
      kind: 'REPLAY',
      status: 'COMPLETED',
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
      responseSnapshot: { printerId: 'printer-1', reconciled: true },
    });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(harness.records[0]?.status).toBe('COMPLETED');
    expect(harness.repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('可按已持久化 identity 收敛 UNKNOWN，无需恢复原始请求明文', async () => {
    const service = buildHarness().service;
    const requestHash = service.hashRequest(claimInput.request);
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash,
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: null,
      },
    ]);

    await expect(
      harness.service.reconcileUnknownByIdentity(harness.manager as never, {
        identity: {
          id: 'record-1',
          adminId: claimInput.adminId,
          operation: claimInput.operation,
          key: claimInput.key,
          requestHash,
        },
        sensitiveValues: [],
        reconcile: async () => ({
          status: 'FAILED',
          resourceType: 'CLOUD_PRINTER',
          resourceId: 'printer-1',
          responseSnapshot: {
            printerId: 'printer-1',
            code: 'RECOVERY_REQUIRED',
          },
        }),
      }),
    ).resolves.toMatchObject({ kind: 'REPLAY', status: 'FAILED' });
    expect(harness.records[0]?.status).toBe('FAILED');
  });

  it('callback 失败时记录始终保持 UNKNOWN', async () => {
    const service = buildHarness().service;
    const requestHash = service.hashRequest(claimInput.request);
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash,
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: null,
      },
    ]);
    const reconcile = vi.fn(async () => {
      expect(harness.records[0]?.status).toBe('IN_PROGRESS');
      return Promise.reject(new Error('network failed'));
    });

    await expect(
      harness.service.reconcileUnknown(harness.manager as never, {
        ...claimInput,
        sensitiveValues: [],
        reconcile,
      }),
    ).rejects.toThrow('network failed');
    expect(harness.records[0]?.status).toBe('UNKNOWN');
  });

  it('已稳定记录直接 replay 且绝不调用 callback 或原外部操作', async () => {
    const service = buildHarness().service;
    const snapshot = { printerId: 'printer-1', reconciled: true };
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash: service.hashRequest(claimInput.request),
        status: 'FAILED',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: snapshot,
      },
    ]);
    const reconcile = vi.fn();

    await expect(
      harness.service.reconcileUnknown(harness.manager as never, {
        ...claimInput,
        sensitiveValues: [],
        reconcile,
      }),
    ).resolves.toMatchObject({
      kind: 'REPLAY',
      status: 'FAILED',
      responseSnapshot: snapshot,
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([
    [
      'displayName 中的真实 SN',
      { displayName: 'Printer SN-FULL-123' },
      ['SN-FULL-123'],
    ],
    [
      'message 中的真实 password',
      { message: 'password=p@ssw0rd!' },
      ['p@ssw0rd!'],
    ],
    [
      '嵌套数组中的真实 token',
      { items: [{ message: 'bearer vendor-token-secret' }] },
      ['vendor-token-secret'],
    ],
  ])(
    '拒绝 reconcile callback snapshot 的 $caseName',
    async (_caseName, responseSnapshot, sensitiveValues) => {
      const service = buildHarness().service;
      const harness = buildHarness([
        {
          id: 'record-1',
          adminId: claimInput.adminId,
          operation: claimInput.operation,
          key: claimInput.key,
          requestHash: service.hashRequest(claimInput.request),
          status: 'UNKNOWN',
          resourceType: 'CLOUD_PRINTER',
          resourceId: 'printer-1',
          responseSnapshot: null,
        },
      ]);

      await expect(
        harness.service.reconcileUnknown(harness.manager as never, {
          ...claimInput,
          sensitiveValues,
          reconcile: async () => ({
            status: 'COMPLETED',
            resourceType: 'CLOUD_PRINTER',
            resourceId: 'printer-1',
            responseSnapshot,
          }),
        }),
      ).rejects.toThrow(/sensitive|敏感/u);
      expect(harness.records[0]?.status).toBe('UNKNOWN');
    },
  );

  it('允许 reconcile callback 的普通 Token Bakery 展示文案', async () => {
    const service = buildHarness().service;
    const harness = buildHarness([
      {
        id: 'record-1',
        adminId: claimInput.adminId,
        operation: claimInput.operation,
        key: claimInput.key,
        requestHash: service.hashRequest(claimInput.request),
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: null,
      },
    ]);

    await expect(
      harness.service.reconcileUnknown(harness.manager as never, {
        ...claimInput,
        sensitiveValues: ['SN-FULL-123', 'actual-password', 'actual-token'],
        reconcile: async () => ({
          status: 'COMPLETED',
          resourceType: 'CLOUD_PRINTER',
          resourceId: 'printer-1',
          responseSnapshot: {
            printerId: 'printer-1',
            displayName: 'Token Bakery',
            message: 'Secret Garden password workshop',
          },
        }),
      }),
    ).resolves.toMatchObject({
      kind: 'REPLAY',
      status: 'COMPLETED',
    });
  });
});

const FENCE_NOW = new Date('2026-08-08T08:10:00.000Z');

const fenceInput = {
  ...claimInput,
  now: FENCE_NOW,
};

const inProgressRecord = (
  service: AdminOperationIdempotencyService,
  updatedAt: Date,
) => ({
  id: 'record-1',
  adminId: claimInput.adminId,
  operation: claimInput.operation,
  key: claimInput.key,
  requestHash: service.hashRequest(claimInput.request),
  status: 'IN_PROGRESS',
  resourceType: null,
  resourceId: null,
  responseSnapshot: null,
  updatedAt,
});

describe('AdminOperationIdempotencyService stale IN_PROGRESS fencing', () => {
  it('固定 stale age 大于芯烨云允许的最大 timeout', () => {
    expect(ADMIN_OPERATION_STALE_AGE_MS).toBe(120_000);
    expect(ADMIN_OPERATION_STALE_AGE_MS).toBeGreaterThan(60_000);
  });

  it('120000ms 边界通过 DB CAS fence 为 UNKNOWN，但不直接写 terminal', async () => {
    const service = buildHarness().service;
    const staleAt = new Date(FENCE_NOW.getTime() - 120_000);
    const harness = buildHarness([inProgressRecord(service, staleAt)]);
    const vendorMutation = vi.fn();

    await expect(
      harness.service.fenceStaleInProgress(
        harness.manager as never,
        fenceInput,
      ),
    ).resolves.toEqual({
      kind: 'FENCED',
      status: 'UNKNOWN',
      resourceType: null,
      resourceId: null,
    });
    expect(vendorMutation).not.toHaveBeenCalled();
    expect(harness.records[0]).toMatchObject({
      status: 'UNKNOWN',
      resourceType: null,
      resourceId: null,
      updatedAt: FENCE_NOW,
    });
    expect(harness.repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'IN_PROGRESS',
        updatedAt: expect.objectContaining({
          _type: 'lessThanOrEqual',
          _value: staleAt,
        }),
      }),
      expect.objectContaining({ status: 'UNKNOWN', updatedAt: FENCE_NOW }),
    );
  });

  it('119999ms 的 IN_PROGRESS 仍视为新鲜', async () => {
    const service = buildHarness().service;
    const freshAt = new Date(FENCE_NOW.getTime() - 119_999);
    const harness = buildHarness([inProgressRecord(service, freshAt)]);

    await expect(
      harness.service.fenceStaleInProgress(
        harness.manager as never,
        fenceInput,
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_IN_PROGRESS),
    );
    expect(harness.records[0]?.status).toBe('IN_PROGRESS');
  });

  it('两个并发调用只有一个新 fence，另一个解析现有 UNKNOWN', async () => {
    const service = buildHarness().service;
    const harness = buildHarness([
      inProgressRecord(service, new Date(FENCE_NOW.getTime() - 120_001)),
    ]);

    const outcomes = await Promise.all([
      harness.service.fenceStaleInProgress(
        harness.manager as never,
        fenceInput,
      ),
      harness.service.fenceStaleInProgress(
        harness.manager as never,
        fenceInput,
      ),
    ]);

    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'FENCED', status: 'UNKNOWN' }),
        expect.objectContaining({
          kind: 'EXISTING_UNKNOWN',
          status: 'UNKNOWN',
        }),
      ]),
    );
    expect(harness.records[0]?.status).toBe('UNKNOWN');
    expect(outcomes.filter(({ kind }) => kind === 'FENCED')).toHaveLength(1);
  });

  it('fence 后原 owner 的 complete CAS 失效', async () => {
    const harness = buildHarness();
    const claimed = await harness.service.claim(
      harness.manager as never,
      claimInput,
    );
    if (claimed.kind !== 'OWNER') throw new Error('owner expected');
    Object.assign(harness.records[0]!, {
      updatedAt: new Date(FENCE_NOW.getTime() - 120_001),
    });

    await harness.service.fenceStaleInProgress(
      harness.manager as never,
      fenceInput,
    );
    await expect(
      harness.service.complete(harness.manager as never, {
        owner: claimed.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
        responseSnapshot: { printerId: 'printer-1' },
        sensitiveValues: [],
      }),
    ).rejects.toThrow(/owner|状态|transition/iu);
    expect(harness.records[0]?.status).toBe('UNKNOWN');
  });

  it('同 scope 不同 hash 冲突', async () => {
    const service = buildHarness().service;
    const harness = buildHarness([
      {
        ...inProgressRecord(service, new Date(FENCE_NOW.getTime() - 120_001)),
        requestHash: 'different-hash',
      },
    ]);

    await expect(
      harness.service.fenceStaleInProgress(
        harness.manager as never,
        fenceInput,
      ),
    ).rejects.toMatchObject(expectApiCode(ApiErrorCode.IDEMPOTENCY_CONFLICT));
    expect(harness.repository.update).not.toHaveBeenCalled();
  });

  it.each(['COMPLETED', 'FAILED'] as const)(
    '已稳定 %s 直接 replay',
    async (status) => {
      const service = buildHarness().service;
      const snapshot = { printerId: 'printer-1', outcome: status };
      const harness = buildHarness([
        {
          ...inProgressRecord(service, new Date(FENCE_NOW.getTime() - 120_001)),
          status,
          resourceType: 'CLOUD_PRINTER',
          resourceId: 'printer-1',
          responseSnapshot: snapshot,
        },
      ]);

      await expect(
        harness.service.fenceStaleInProgress(
          harness.manager as never,
          fenceInput,
        ),
      ).resolves.toMatchObject({
        kind: 'REPLAY',
        status,
        responseSnapshot: snapshot,
      });
      expect(harness.repository.update).not.toHaveBeenCalled();
    },
  );

  it('现有 UNKNOWN 被解析且不会重新执行任何恢复逻辑', async () => {
    const service = buildHarness().service;
    const harness = buildHarness([
      {
        ...inProgressRecord(service, new Date(FENCE_NOW.getTime() - 120_001)),
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'printer-1',
      },
    ]);

    await expect(
      harness.service.fenceStaleInProgress(
        harness.manager as never,
        fenceInput,
      ),
    ).resolves.toEqual({
      kind: 'EXISTING_UNKNOWN',
      status: 'UNKNOWN',
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'printer-1',
    });
    expect(harness.repository.update).not.toHaveBeenCalled();
  });

  it('拒绝无效 now 且调用方不能提供 stale cutoff', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.fenceStaleInProgress(harness.manager as never, {
        ...fenceInput,
        now: new Date(Number.NaN),
      }),
    ).rejects.toThrow(/now|valid/iu);
    expect(harness.repository.findOne).not.toHaveBeenCalled();
  });
});
