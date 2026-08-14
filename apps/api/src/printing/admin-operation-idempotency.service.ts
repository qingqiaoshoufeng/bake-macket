import { ApiErrorCode } from '@bake-mall/contracts';
import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac } from 'node:crypto';

import type { AppConfig } from '../config/env.schema.js';
import { LessThanOrEqual, type Repository } from 'typeorm';

import {
  AdminOperationIdempotency,
  type AdminOperationIdempotencyStatus,
} from '../database/entities/admin-operation-idempotency.entity.js';

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type OperationIdentity = Readonly<{
  id: string;
  adminId: string;
  operation: string;
  key: string;
  requestHash: string;
}>;

type ClaimInput = Readonly<{
  adminId: string;
  operation: string;
  key: string;
  request: unknown;
}>;

type ResponseSnapshot = Record<string, unknown>;

type Replay = Readonly<{
  kind: 'REPLAY';
  status: 'COMPLETED' | 'FAILED';
  resourceType: string | null;
  resourceId: string | null;
  responseSnapshot: ResponseSnapshot | null;
}>;

type Owner = Readonly<{ kind: 'OWNER'; owner: OperationIdentity }>;
export type AdminOperationClaim = Owner | Replay;
export type AdminOperationLookup =
  | Replay
  | Readonly<{ kind: 'ABSENT' }>
  | Readonly<{ kind: 'CONTINUE'; status: 'IN_PROGRESS' | 'UNKNOWN' }>;

export type UnknownIdentityClaim = Readonly<{
  kind: 'UNKNOWN';
  identity: OperationIdentity;
  resourceType: string | null;
  resourceId: string | null;
  responseSnapshot: ResponseSnapshot | null;
}>;

export type CompleteInput = Readonly<{
  owner: OperationIdentity;
  resourceType: string;
  resourceId: string;
  responseSnapshot: ResponseSnapshot;
  sensitiveValues: readonly string[];
}>;

export type FailInput = Readonly<{
  owner: OperationIdentity;
  resourceType?: string | null;
  resourceId?: string | null;
  responseSnapshot?: ResponseSnapshot | null;
  sensitiveValues: readonly string[];
}>;

type UnknownInput = Readonly<{
  owner: OperationIdentity;
  resourceType: string;
  resourceId: string;
  responseSnapshot?: ResponseSnapshot;
  sensitiveValues?: readonly string[];
}>;

export type ReconcileResult = Readonly<{
  status: 'COMPLETED' | 'FAILED' | 'UNKNOWN';
  resourceType: string;
  resourceId: string | null;
  responseSnapshot: ResponseSnapshot | null;
}>;

export type ReconcileInput = ClaimInput &
  Readonly<{
    sensitiveValues: readonly string[];
    reconcile: (context: {
      operation: string;
      resourceType: string | null;
      resourceId: string | null;
    }) => Promise<ReconcileResult>;
  }>;

export type ReconcileByIdentityInput = Readonly<{
  identity: OperationIdentity;
  sensitiveValues: readonly string[];
  reconcile: (context: {
    operation: string;
    resourceType: string | null;
    resourceId: string | null;
  }) => Promise<ReconcileResult>;
}>;

export type FenceStaleInProgressInput = ClaimInput &
  Readonly<{
    now: Date;
  }>;

export type FenceStaleInProgressResult =
  | Replay
  | Readonly<{
      kind: 'FENCED' | 'EXISTING_UNKNOWN';
      status: 'UNKNOWN';
      resourceType: string | null;
      resourceId: string | null;
    }>;

export const ADMIN_OPERATION_STALE_AGE_MS = 120_000;

const pathText = (path: readonly string[]): string =>
  path.length === 0 ? '<root>' : path.join('.');

const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const stableJson = (
  value: unknown,
  path: readonly string[] = [],
  seen = new Set<object>(),
): JsonValue => {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `canonical JSON contains non-finite number at ${pathText(path)}`,
      );
    }
    return value;
  }
  if (typeof value !== 'object' || value instanceof Date) {
    throw new TypeError(
      `canonical JSON contains non-JSON value at ${pathText(path)}`,
    );
  }
  if (seen.has(value)) {
    throw new TypeError(`canonical JSON contains cycle at ${pathText(path)}`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      const expectedKeys = [...value.keys()].map(String);
      const actualKeys = ownKeys.filter((key) => key !== 'length');
      if (
        actualKeys.length !== expectedKeys.length ||
        actualKeys.some((key, index) => key !== expectedKeys[index])
      ) {
        throw new TypeError(
          `canonical JSON contains sparse or extended array at ${pathText(path)}`,
        );
      }
      return value.map((child, index) =>
        stableJson(child, [...path, String(index)], seen),
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `canonical JSON contains non-JSON object at ${pathText(path)}`,
      );
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      throw new TypeError(
        `canonical JSON contains symbol key at ${pathText(path)}`,
      );
    }
    const keys = ownKeys as string[];
    const forbiddenKey = keys.find((key) => POLLUTION_KEYS.has(key));
    if (forbiddenKey) {
      throw new TypeError(
        `canonical JSON contains prototype pollution key at ${pathText([
          ...path,
          forbiddenKey,
        ])}`,
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const unsupportedKey = keys.find((key) => {
      const descriptor = descriptors[key];
      return (
        !descriptor?.enumerable ||
        typeof descriptor.get === 'function' ||
        typeof descriptor.set === 'function'
      );
    });
    if (unsupportedKey) {
      throw new TypeError(
        `canonical JSON contains unsupported property at ${pathText([
          ...path,
          unsupportedKey,
        ])}`,
      );
    }
    return Object.fromEntries(
      keys
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        .map((key) => [
          key,
          stableJson(
            (value as Record<string, unknown>)[key],
            [...path, key],
            seen,
          ),
        ]),
    );
  } finally {
    seen.delete(value);
  }
};

const normalizedKey = (key: string): string =>
  key.replace(/[^a-z0-9]/giu, '').toLowerCase();

const sensitiveKey = (key: string): boolean => {
  const normalized = normalizedKey(key);
  if (normalized === 'serialnumbermasked') return false;
  return (
    normalized.includes('password') ||
    normalized.includes('passwd') ||
    normalized.includes('credential') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('userkey') ||
    normalized === 'sign' ||
    normalized === 'signature' ||
    normalized.includes('authorization') ||
    normalized === 'requesthash' ||
    normalized === 'serialnumber' ||
    normalized === 'challengeplaintext' ||
    normalized === 'verificationcode'
  );
};
const ALLOWED_SNAPSHOT_KEYS = new Set([
  'printer',
  'printerId',
  'bindingOperationId',
  'version',
  'resourceId',
  'id',
  'displayName',
  'status',
  'outcome',
  'reconciled',
  'code',
  'message',
  'serialNumberMasked',
  'vendorCode',
  'challenge',
  'expiresAt',
  'remainingAttempts',
  'challengeId',
  'onlineStatus',
  'lastStatusCheckedAt',
  'bindingStage',
  'vendorRelationState',
  'items',
  'total',
  'page',
  'pageSize',
  'allowlistSatisfied',
  'rejectedKeys',
  'batch',
  'jobs',
  'job',
  'createdByAdminId',
  'leaseOwner',
  'leaseExpiresAt',
  'totalCount',
  'classifiedCount',
  'pendingCount',
  'submittingCount',
  'acceptedCount',
  'failedCount',
  'unknownCount',
  'manualReviewCount',
  'manuallyResolvedCount',
  'cancelledCount',
  'createdAt',
  'updatedAt',
  'batchId',
  'orderId',
  'sequence',
  'vendorJobId',
  'vendorErrorCode',
  'acceptedAt',
  'manualResolution',
  'manualResolutionByAdminId',
  'manualResolutionAt',
  'supersedesJobId',
  'payloadRedactedAt',
  'processedCount',
  'accepted',
  'failed',
  'unknown',
  'manualReview',
  'resolution',
  'retryBatch',
  'retryJob',
  'originalBatch',
  'originalJob',
]);

const SHORT_SENSITIVE_VALUE_LENGTH = 4;

const assertSafeSnapshot = (
  snapshot: unknown,
  sensitiveValues: readonly string[],
): ResponseSnapshot => {
  const candidates = [
    ...new Set(sensitiveValues.filter((value) => value.length > 0)),
  ];
  const visit = (value: unknown, key?: string): void => {
    if (key && sensitiveKey(key)) {
      throw new Error(`response snapshot contains sensitive key: ${key}`);
    }
    if (key !== undefined && !ALLOWED_SNAPSHOT_KEYS.has(key)) {
      throw new Error(`response snapshot key ${key} not in allowlist`);
    }
    if (typeof value === 'string') {
      const containsSensitiveValue = candidates.some((candidate) =>
        candidate.length <= SHORT_SENSITIVE_VALUE_LENGTH
          ? value === candidate
          : value.includes(candidate),
      );
      if (containsSensitiveValue) {
        throw new Error('response snapshot contains sensitive value');
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([childKey, child]) =>
        visit(child, childKey),
      );
    }
  };

  const canonical = stableJson(snapshot);
  visit(canonical);
  if (
    canonical === null ||
    Array.isArray(canonical) ||
    typeof canonical !== 'object'
  ) {
    throw new Error('response snapshot must be an object');
  }
  return structuredClone(canonical) as ResponseSnapshot;
};

const inProgress = (): ConflictException =>
  new ConflictException({
    code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
    message: '相同管理员操作正在处理中',
  });

const resultUnknown = (): ConflictException =>
  new ConflictException({
    code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
    message: '操作结果未知，必须显式恢复后再继续',
  });

const conflict = (): ConflictException =>
  new ConflictException({
    code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
    message: 'Idempotency-Key 与请求内容不一致',
  });

const isUniqueViolation = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    (error as { code?: string }).code === 'ER_DUP_ENTRY',
  );

function assertBoundedText(
  name: string,
  value: unknown,
  maximumLength: number,
  pattern?: RegExp,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    (pattern && !pattern.test(value))
  ) {
    throw new TypeError(
      `${name} is invalid or exceeds length ${maximumLength}`,
    );
  }
}

const CANONICAL_LOWERCASE_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const isCanonicalAdminOperationIdempotencyKey = (
  value: unknown,
): value is string =>
  typeof value === 'string' && CANONICAL_LOWERCASE_UUID_V4.test(value);

const assertClaimInput = (input: ClaimInput): void => {
  assertBoundedText('adminId', input.adminId, 64, /^[A-Za-z0-9_-]+$/u);
  assertBoundedText('operation', input.operation, 64, /^[A-Z][A-Z0-9_]*$/u);
  if (!isCanonicalAdminOperationIdempotencyKey(input.key)) {
    throw new TypeError('key must be a canonical lowercase UUID v4');
  }
};

const assertResourceIdentity = (
  resourceType: string,
  resourceId: string,
  snapshot: ResponseSnapshot,
): void => {
  assertBoundedText('resourceType', resourceType, 64, /^[A-Z][A-Z0-9_]*$/u);
  assertBoundedText('resourceId', resourceId, 64, /^[!-~]+$/u);

  const candidateIds: unknown[] = [snapshot.resourceId, snapshot.printerId];
  const nestedResourceKey =
    resourceType === 'CLOUD_PRINTER'
      ? 'printer'
      : resourceType === 'PRINT_BATCH'
        ? 'batch'
        : resourceType === 'PRINT_JOB'
          ? 'job'
          : null;
  const nestedResource = nestedResourceKey
    ? snapshot[nestedResourceKey]
    : undefined;
  if (
    nestedResource &&
    typeof nestedResource === 'object' &&
    !Array.isArray(nestedResource)
  ) {
    candidateIds.push((nestedResource as Record<string, unknown>).id);
  }
  const inconsistent = candidateIds.some(
    (candidate) => candidate !== undefined && candidate !== resourceId,
  );
  if (inconsistent) {
    throw new Error('response snapshot resource id is inconsistent');
  }
};

const assertPersistedReplay = (
  record: AdminOperationIdempotency,
): ResponseSnapshot | null => {
  if (record.status === 'FAILED') {
    const snapshot =
      record.responseSnapshot === null
        ? null
        : assertSafeSnapshot(record.responseSnapshot, []);
    if (record.resourceType !== null) {
      assertBoundedText(
        'resourceType',
        record.resourceType,
        64,
        /^[A-Z][A-Z0-9_]*$/u,
      );
    }
    if (record.resourceId !== null) {
      assertBoundedText('resourceId', record.resourceId, 64, /^[!-~]+$/u);
    }
    if (
      snapshot !== null &&
      record.resourceType !== null &&
      record.resourceId !== null
    ) {
      assertResourceIdentity(record.resourceType, record.resourceId, snapshot);
    }
    return snapshot;
  }
  if (record.resourceType === null || record.resourceId === null) {
    throw new Error('persisted terminal resource identity is incomplete');
  }
  const snapshot = assertSafeSnapshot(record.responseSnapshot, []);
  assertResourceIdentity(record.resourceType, record.resourceId, snapshot);
  return snapshot;
};

@Injectable()
export class AdminOperationIdempotencyService {
  private readonly ownerCapabilities = new WeakSet<OperationIdentity>();

  constructor(
    @InjectRepository(AdminOperationIdempotency)
    private readonly records: Repository<AdminOperationIdempotency>,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  hashRequest(request: unknown): string {
    const canonical = stableJson(request);
    const secret = this.config.get('appEnv', {
      infer: true,
    }).ADMIN_OPERATION_IDEMPOTENCY_SECRET;
    const requestForHash = this.hmacSensitiveRequest(canonical, secret);
    return createHash('sha256')
      .update(JSON.stringify(requestForHash), 'utf8')
      .digest('hex');
  }

  private hmacSensitiveRequest(
    value: JsonValue,
    secret: string,
    key?: string,
  ): JsonValue {
    if (key && sensitiveKey(key)) {
      return createHmac('sha256', secret)
        .update(JSON.stringify(value), 'utf8')
        .digest('hex');
    }
    if (Array.isArray(value)) {
      return value.map((child) => this.hmacSensitiveRequest(child, secret));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [
          childKey,
          this.hmacSensitiveRequest(child, secret, childKey),
        ]),
      );
    }
    return value;
  }

  async lookup(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    input: ClaimInput,
  ): Promise<AdminOperationLookup> {
    assertClaimInput(input);
    const requestHash = this.hashRequest(input.request);
    const existing = await manager
      .getRepository(AdminOperationIdempotency)
      .findOne({
        where: {
          adminId: input.adminId,
          operation: input.operation,
          key: input.key,
        },
      });
    if (!existing) return { kind: 'ABSENT' };
    if (existing.requestHash !== requestHash) throw conflict();
    if (existing.status === 'IN_PROGRESS' || existing.status === 'UNKNOWN') {
      return { kind: 'CONTINUE', status: existing.status };
    }
    return this.resolveExisting(existing);
  }

  async claim(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    input: ClaimInput,
  ): Promise<AdminOperationClaim> {
    assertClaimInput(input);
    const requestHash = this.hashRequest(input.request);
    const repository = manager.getRepository(AdminOperationIdempotency);

    try {
      const inserted = await repository.insert({
        adminId: input.adminId,
        operation: input.operation,
        key: input.key,
        requestHash,
        status: 'IN_PROGRESS',
        resourceType: null,
        resourceId: null,
        responseSnapshot: null,
      });
      const id = String(inserted.identifiers[0]?.id ?? '');
      assertBoundedText('inserted id', id, 64, /^[A-Za-z0-9_-]+$/u);
      const owner = Object.freeze({
        id,
        adminId: input.adminId,
        operation: input.operation,
        key: input.key,
        requestHash,
      }) satisfies OperationIdentity;
      this.ownerCapabilities.add(owner);
      return { kind: 'OWNER', owner };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const existing = await repository.findOne({
      where: {
        adminId: input.adminId,
        operation: input.operation,
        key: input.key,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!existing) throw inProgress();
    if (existing.requestHash !== requestHash) throw conflict();
    return this.resolveExisting(existing);
  }

  async findUnknownForResource(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    input: Readonly<{
      adminId: string;
      operation: string;
      resourceType: string;
      resourceId: string;
    }>,
  ): Promise<UnknownIdentityClaim | null> {
    assertBoundedText('adminId', input.adminId, 64, /^[A-Za-z0-9_-]+$/u);
    assertBoundedText('operation', input.operation, 64, /^[A-Z][A-Z0-9_]*$/u);
    assertBoundedText(
      'resourceType',
      input.resourceType,
      64,
      /^[A-Z][A-Z0-9_]*$/u,
    );
    assertBoundedText('resourceId', input.resourceId, 64, /^[!-~]+$/u);
    const existing = await manager
      .getRepository(AdminOperationIdempotency)
      .findOne({
        where: {
          adminId: input.adminId,
          operation: input.operation,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          status: 'UNKNOWN',
        },
        lock: { mode: 'pessimistic_write' },
      });
    if (!existing) return null;
    return {
      kind: 'UNKNOWN',
      identity: this.identity(existing),
      resourceType: existing.resourceType,
      resourceId: existing.resourceId,
      responseSnapshot:
        existing.responseSnapshot === null
          ? null
          : assertSafeSnapshot(existing.responseSnapshot, []),
    };
  }

  async claimOrReconcileUnknown(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    input: ClaimInput,
  ): Promise<AdminOperationClaim | UnknownIdentityClaim> {
    assertClaimInput(input);
    const requestHash = this.hashRequest(input.request);
    const repository = manager.getRepository(AdminOperationIdempotency);
    const existing = await repository.findOne({
      where: {
        adminId: input.adminId,
        operation: input.operation,
        key: input.key,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!existing) {
      const claimed = await this.claim(manager, input);
      return claimed;
    }
    if (existing.requestHash !== requestHash) throw conflict();
    if (existing.status === 'UNKNOWN') {
      return {
        kind: 'UNKNOWN',
        identity: this.identity(existing),
        resourceType: existing.resourceType,
        resourceId: existing.resourceId,
        responseSnapshot:
          existing.responseSnapshot === null
            ? null
            : assertSafeSnapshot(existing.responseSnapshot, []),
      };
    }
    return this.resolveExisting(existing);
  }

  async complete(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    input: CompleteInput,
  ): Promise<void> {
    const snapshot = assertSafeSnapshot(
      input.responseSnapshot,
      input.sensitiveValues,
    );
    assertResourceIdentity(input.resourceType, input.resourceId, snapshot);
    await this.transition(manager, input.owner, 'COMPLETED', {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      responseSnapshot: snapshot,
    });
  }

  async fail(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    input: FailInput,
  ): Promise<void> {
    const resourceType = input.resourceType ?? null;
    const resourceId = input.resourceId ?? null;
    const snapshot = input.responseSnapshot
      ? assertSafeSnapshot(input.responseSnapshot, input.sensitiveValues)
      : null;
    if (resourceType !== null) {
      assertBoundedText('resourceType', resourceType, 64, /^[A-Z][A-Z0-9_]*$/u);
    }
    if (resourceId !== null) {
      assertBoundedText('resourceId', resourceId, 64, /^[!-~]+$/u);
    }
    if (snapshot !== null && resourceType !== null && resourceId !== null) {
      assertResourceIdentity(resourceType, resourceId, snapshot);
    }
    await this.transition(manager, input.owner, 'FAILED', {
      resourceType,
      resourceId,
      responseSnapshot: snapshot,
    });
  }

  async markUnknown(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    input: UnknownInput,
  ): Promise<void> {
    assertBoundedText(
      'resourceType',
      input.resourceType,
      64,
      /^[A-Z][A-Z0-9_]*$/u,
    );
    assertBoundedText('resourceId', input.resourceId, 64, /^[!-~]+$/u);
    const snapshot = assertSafeSnapshot(
      input.responseSnapshot ?? { resourceId: input.resourceId },
      input.sensitiveValues ?? [],
    );
    assertResourceIdentity(input.resourceType, input.resourceId, snapshot);
    this.assertOwnerCapability(input.owner);
    const result = await manager
      .getRepository(AdminOperationIdempotency)
      .update(
        {
          id: input.owner.id,
          adminId: input.owner.adminId,
          operation: input.owner.operation,
          key: input.owner.key,
          requestHash: input.owner.requestHash,
          status: 'IN_PROGRESS',
        },
        {
          status: 'UNKNOWN',
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          responseSnapshot: snapshot,
        } as never,
      );
    if (result.affected !== 1) {
      throw new Error('幂等 owner 状态 transition 失败');
    }
  }

  async reconcileUnknown(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    input: ReconcileInput,
  ): Promise<AdminOperationClaim> {
    assertClaimInput(input);
    const requestHash = this.hashRequest(input.request);
    const repository = manager.getRepository(AdminOperationIdempotency);
    const existing = await repository.findOne({
      where: {
        adminId: input.adminId,
        operation: input.operation,
        key: input.key,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!existing) throw resultUnknown();
    if (existing.requestHash !== requestHash) throw conflict();
    if (existing.status !== 'UNKNOWN') return this.resolveExisting(existing);

    return this.reconcileOwnedUnknown(repository, existing, requestHash, input);
  }

  async reconcileUnknownByIdentity(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    input: ReconcileByIdentityInput,
  ): Promise<AdminOperationClaim> {
    assertBoundedText('id', input.identity.id, 64, /^[A-Za-z0-9_-]+$/u);
    assertBoundedText(
      'adminId',
      input.identity.adminId,
      64,
      /^[A-Za-z0-9_-]+$/u,
    );
    assertBoundedText(
      'operation',
      input.identity.operation,
      64,
      /^[A-Z][A-Z0-9_]*$/u,
    );
    if (!isCanonicalAdminOperationIdempotencyKey(input.identity.key)) {
      throw new TypeError('key must be a canonical lowercase UUID v4');
    }
    assertBoundedText(
      'requestHash',
      input.identity.requestHash,
      64,
      /^[a-f0-9]{64}$/u,
    );
    const repository = manager.getRepository(AdminOperationIdempotency);
    const existing = await repository.findOne({
      where: {
        id: input.identity.id,
        adminId: input.identity.adminId,
        operation: input.identity.operation,
        key: input.identity.key,
        requestHash: input.identity.requestHash,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!existing) throw resultUnknown();
    if (existing.status !== 'UNKNOWN') return this.resolveExisting(existing);
    return this.reconcileOwnedUnknown(
      repository,
      existing,
      input.identity.requestHash,
      {
        adminId: input.identity.adminId,
        operation: input.identity.operation,
        key: input.identity.key,
        request: {},
        sensitiveValues: input.sensitiveValues,
        reconcile: input.reconcile,
      },
    );
  }

  async fenceStaleInProgress(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    input: FenceStaleInProgressInput,
  ): Promise<FenceStaleInProgressResult> {
    assertClaimInput(input);
    if (!Number.isFinite(input.now.getTime())) {
      throw new TypeError('now must be a valid date');
    }

    const requestHash = this.hashRequest(input.request);
    const repository = manager.getRepository(AdminOperationIdempotency);
    const existing = await repository.findOne({
      where: {
        adminId: input.adminId,
        operation: input.operation,
        key: input.key,
      },
    });
    if (!existing) throw resultUnknown();
    if (existing.requestHash !== requestHash) throw conflict();
    if (existing.status === 'UNKNOWN') {
      return {
        kind: 'EXISTING_UNKNOWN',
        status: 'UNKNOWN',
        resourceType: existing.resourceType,
        resourceId: existing.resourceId,
      };
    }
    if (existing.status !== 'IN_PROGRESS')
      return this.resolveExisting(existing);

    const cutoff = new Date(input.now.getTime() - ADMIN_OPERATION_STALE_AGE_MS);
    const fenced = await repository.update(
      {
        id: existing.id,
        adminId: input.adminId,
        operation: input.operation,
        key: input.key,
        requestHash,
        status: 'IN_PROGRESS',
        updatedAt: LessThanOrEqual(cutoff),
      },
      { status: 'UNKNOWN', updatedAt: input.now } as never,
    );
    if (fenced.affected !== 1) {
      const current = await repository.findOne({
        where: {
          adminId: input.adminId,
          operation: input.operation,
          key: input.key,
        },
      });
      if (current?.requestHash !== requestHash) throw conflict();
      if (current?.status === 'UNKNOWN') {
        return {
          kind: 'EXISTING_UNKNOWN',
          status: 'UNKNOWN',
          resourceType: current.resourceType,
          resourceId: current.resourceId,
        };
      }
      if (current && current.status !== 'IN_PROGRESS') {
        return this.resolveExisting(current);
      }
      throw inProgress();
    }

    return {
      kind: 'FENCED',
      status: 'UNKNOWN',
      resourceType: existing.resourceType,
      resourceId: existing.resourceId,
    };
  }

  private async reconcileOwnedUnknown(
    repository: Repository<AdminOperationIdempotency>,
    existing: AdminOperationIdempotency,
    requestHash: string,
    input: ReconcileInput,
  ): Promise<AdminOperationClaim> {
    const claimed = await repository.update(
      {
        id: existing.id,
        adminId: input.adminId,
        operation: input.operation,
        key: input.key,
        requestHash,
        status: 'UNKNOWN',
      },
      { status: 'IN_PROGRESS' } as never,
    );
    if (claimed.affected !== 1) throw inProgress();
    return this.runReconcile(
      repository,
      existing,
      requestHash,
      input,
      'IN_PROGRESS',
    );
  }

  private async runReconcile(
    repository: Repository<AdminOperationIdempotency>,
    existing: AdminOperationIdempotency,
    requestHash: string,
    input: ReconcileInput,
    ownedStatus: 'IN_PROGRESS' | 'UNKNOWN',
  ): Promise<AdminOperationClaim> {
    try {
      const outcome = await input.reconcile({
        operation: existing.operation,
        resourceType: existing.resourceType,
        resourceId: existing.resourceId,
      });
      const snapshot = outcome.responseSnapshot
        ? assertSafeSnapshot(outcome.responseSnapshot, input.sensitiveValues)
        : null;
      assertBoundedText(
        'resourceType',
        outcome.resourceType,
        64,
        /^[A-Z][A-Z0-9_]*$/u,
      );
      if (outcome.resourceId !== null) {
        assertBoundedText('resourceId', outcome.resourceId, 64, /^[!-~]+$/u);
        if (snapshot) {
          assertResourceIdentity(
            outcome.resourceType,
            outcome.resourceId,
            snapshot,
          );
        }
      } else if (snapshot !== null) {
        throw new Error('response snapshot requires a resource id');
      } else if (outcome.status === 'COMPLETED') {
        throw new Error('completed reconciliation requires a resource id');
      }

      const updated = await repository.update(
        {
          id: existing.id,
          adminId: input.adminId,
          operation: input.operation,
          key: input.key,
          requestHash,
          status: ownedStatus,
        },
        {
          status: outcome.status,
          resourceType: outcome.resourceType,
          resourceId: outcome.resourceId,
          responseSnapshot: snapshot,
        } as never,
      );
      if (updated.affected !== 1) throw inProgress();
      if (outcome.status === 'UNKNOWN') throw resultUnknown();
      return {
        kind: 'REPLAY',
        status: outcome.status,
        resourceType: outcome.resourceType,
        resourceId: outcome.resourceId,
        responseSnapshot: snapshot,
      };
    } catch (error) {
      await repository.update(
        {
          id: existing.id,
          adminId: input.adminId,
          operation: input.operation,
          key: input.key,
          requestHash,
          status: ownedStatus,
        },
        { status: 'UNKNOWN' } as never,
      );
      throw error;
    }
  }

  private async transition(
    manager: {
      getRepository(
        entity: typeof AdminOperationIdempotency,
      ): Repository<AdminOperationIdempotency>;
    },
    owner: OperationIdentity,
    status: AdminOperationIdempotencyStatus,
    values: Readonly<{
      resourceType: string | null;
      resourceId: string | null;
      responseSnapshot: ResponseSnapshot | null;
    }>,
  ): Promise<void> {
    this.assertOwnerCapability(owner);
    const result = await manager
      .getRepository(AdminOperationIdempotency)
      .update(
        {
          id: owner.id,
          adminId: owner.adminId,
          operation: owner.operation,
          key: owner.key,
          requestHash: owner.requestHash,
          status: 'IN_PROGRESS',
        },
        { ...values, status } as never,
      );
    if (result.affected !== 1) {
      throw new Error('幂等 owner 状态 transition 失败');
    }
  }

  private assertOwnerCapability(owner: OperationIdentity): void {
    if (!this.ownerCapabilities.has(owner)) {
      throw new Error('幂等 owner capability 无效');
    }
  }

  private identity(record: AdminOperationIdempotency): OperationIdentity {
    return Object.freeze({
      id: String(record.id),
      adminId: record.adminId,
      operation: record.operation,
      key: record.key,
      requestHash: record.requestHash,
    });
  }

  private resolveExisting(record: AdminOperationIdempotency): Replay {
    if (record.status === 'IN_PROGRESS') throw inProgress();
    if (record.status === 'UNKNOWN') throw resultUnknown();
    const snapshot = assertPersistedReplay(record);
    return {
      kind: 'REPLAY',
      status: record.status,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      responseSnapshot: snapshot,
    };
  }
}
