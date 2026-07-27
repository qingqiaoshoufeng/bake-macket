import { ApiErrorCode } from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { IdempotencyRecord } from '../database/entities/idempotency-record.entity.js';
import { IdempotencyService } from './idempotency.service.js';

type Snapshot = { id: string; value: string };

const snapshotGuard = (
  snapshot: unknown,
  resourceId: string,
): snapshot is Snapshot =>
  typeof snapshot === 'object' &&
  snapshot !== null &&
  (snapshot as { id?: unknown }).id === resourceId;

function buildHarness(records: Array<Record<string, unknown>> = []) {
  const repo = {
    findOne: vi.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        records.find((record) =>
          Object.entries(where).every(([key, value]) => record[key] === value),
        ) ?? null,
    ),
    insert: vi.fn(async (value: Record<string, unknown>) => {
      records.push({ id: String(records.length + 1), ...value });
      return { identifiers: [] };
    }),
    update: vi.fn(
      async (
        where: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => {
        const matching = records.filter((record) =>
          Object.entries(where).every(([key, value]) => record[key] === value),
        );
        matching.forEach((record) => Object.assign(record, values));
        return { affected: matching.length };
      },
    ),
  };
  const manager = {
    getRepository: (entity: unknown) => {
      expect(entity).toBe(IdempotencyRecord);
      return repo;
    },
  };
  return {
    records,
    repo,
    manager,
    service: new IdempotencyService(repo as never),
  };
}

const input = {
  userId: 'user-1',
  operation: 'PRODUCT_ORDER_CREATE',
  key: 'idem-1',
  requestHash: 'hash-1',
  resourceType: 'ORDER',
  snapshotGuard,
};

describe('IdempotencyService', () => {
  it('hashes semantic objects stably regardless of object key insertion order', () => {
    const service = buildHarness().service;

    expect(
      service.hashRequest({ z: 1, nested: { b: 2, a: 1 }, items: ['b', 'a'] }),
    ).toBe(
      service.hashRequest({ items: ['b', 'a'], nested: { a: 1, b: 2 }, z: 1 }),
    );
  });

  it('replays a valid completed response snapshot scoped by operation', async () => {
    const snapshot = { id: 'order-1', value: 'original' };
    const harness = buildHarness([
      {
        id: 'record-1',
        userId: input.userId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
        status: 'COMPLETED',
        resourceType: input.resourceType,
        resourceId: snapshot.id,
        responseSnapshot: snapshot,
      },
    ]);

    await expect(harness.service.findReplay(input)).resolves.toEqual(snapshot);
    expect(harness.repo.findOne).toHaveBeenCalledWith({
      where: {
        userId: input.userId,
        operation: input.operation,
        key: input.key,
      },
    });
  });

  it('rejects conflicting hashes, in-progress requests, and corrupt snapshots', async () => {
    const cases = [
      {
        record: { requestHash: 'other', status: 'COMPLETED' },
        code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
      },
      {
        record: { requestHash: input.requestHash, status: 'IN_PROGRESS' },
        code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
      },
    ];

    for (const { record, code } of cases) {
      const service = buildHarness([
        {
          id: 'record-1',
          userId: input.userId,
          operation: input.operation,
          key: input.key,
          resourceType: null,
          resourceId: null,
          responseSnapshot: null,
          ...record,
        },
      ]).service;
      await expect(service.findReplay(input)).rejects.toMatchObject({
        response: expect.objectContaining({ code }),
      });
    }

    const corrupt = buildHarness([
      {
        id: 'record-1',
        userId: input.userId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
        status: 'COMPLETED',
        resourceType: input.resourceType,
        resourceId: 'order-1',
        responseSnapshot: { id: 'wrong' },
      },
    ]).service;
    await expect(corrupt.findReplay(input)).rejects.toThrow('幂等记录已损坏');
  });

  it('reserves a new operation and reclaims only a FAILED record with the same hash', async () => {
    const fresh = buildHarness();
    await expect(
      fresh.service.reserve(fresh.manager as never, input),
    ).resolves.toBeNull();
    expect(fresh.records[0]).toMatchObject({
      userId: input.userId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      status: 'IN_PROGRESS',
    });

    const failed = buildHarness([
      {
        id: 'record-1',
        userId: input.userId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
        status: 'FAILED',
      },
    ]);
    const duplicate = Object.assign(new Error('duplicate'), {
      code: 'ER_DUP_ENTRY',
    });
    failed.repo.insert.mockRejectedValueOnce(duplicate);

    await expect(
      failed.service.reserve(failed.manager as never, input),
    ).resolves.toBeNull();
    expect(failed.records[0]).toMatchObject({
      status: 'IN_PROGRESS',
      resourceType: null,
      resourceId: null,
      responseSnapshot: null,
    });
  });

  it('completes the reservation with a validated response snapshot', async () => {
    const harness = buildHarness([
      {
        id: 'record-1',
        userId: input.userId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
        status: 'IN_PROGRESS',
      },
    ]);
    const snapshot = { id: 'order-1', value: 'complete' };

    await harness.service.complete(harness.manager as never, {
      userId: input.userId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      resourceType: input.resourceType,
      resourceId: snapshot.id,
      responseSnapshot: snapshot,
      legacyOrderId: snapshot.id,
    });

    expect(harness.records[0]).toMatchObject({
      status: 'COMPLETED',
      resourceType: input.resourceType,
      resourceId: snapshot.id,
      responseSnapshot: snapshot,
      orderId: snapshot.id,
    });
  });
});
