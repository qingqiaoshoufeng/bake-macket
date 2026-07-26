import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiErrorCode } from '@bake-mall/contracts';
import { createHash } from 'node:crypto';
import { type EntityManager, type Repository } from 'typeorm';

import { IdempotencyRecord } from '../database/entities/idempotency-record.entity.js';

type SnapshotGuard<TSnapshot> = (
  snapshot: unknown,
  resourceId: string,
) => snapshot is TSnapshot;

export type IdempotencyResolutionInput<TSnapshot> = {
  userId: string;
  operation: string;
  key: string;
  requestHash: string;
  resourceType: string;
  snapshotGuard: SnapshotGuard<TSnapshot>;
};

export type IdempotencyCompletionInput<
  TSnapshot extends Record<string, unknown>,
> = {
  userId: string;
  operation: string;
  key: string;
  requestHash: string;
  resourceType: string;
  resourceId: string;
  responseSnapshot: TSnapshot;
  legacyOrderId?: string | null;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
};

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly records: Repository<IdempotencyRecord>,
  ) {}

  hashRequest(request: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(stableValue(request)))
      .digest('hex');
  }

  async findReplay<TSnapshot>(
    input: IdempotencyResolutionInput<TSnapshot>,
  ): Promise<TSnapshot | null> {
    const record = await this.records.findOne({
      where: {
        userId: input.userId,
        operation: input.operation,
        key: input.key,
      },
    });
    return record ? this.resolve(record, input) : null;
  }

  async reserve<TSnapshot>(
    manager: EntityManager,
    input: IdempotencyResolutionInput<TSnapshot>,
  ): Promise<TSnapshot | null> {
    const records = manager.getRepository(IdempotencyRecord);
    try {
      await records.insert({
        userId: input.userId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
        status: 'IN_PROGRESS',
        resourceType: null,
        resourceId: null,
        responseSnapshot: null,
        orderId: null,
        expiresAt: null,
      });
      return null;
    } catch (error) {
      if (!IdempotencyService.isUniqueViolation(error)) throw error;
    }

    const raced = await records.findOne({
      where: {
        userId: input.userId,
        operation: input.operation,
        key: input.key,
      },
    });
    if (!raced) throw IdempotencyService.inProgress();
    const replay = this.resolve(raced, input);
    if (replay) return replay;

    const claimed = await records.update(
      {
        id: raced.id,
        status: 'FAILED',
        requestHash: input.requestHash,
      },
      {
        status: 'IN_PROGRESS',
        resourceType: null,
        resourceId: null,
        responseSnapshot: null,
        orderId: null,
      },
    );
    if (claimed.affected === 1) return null;

    const changed = await records.findOne({ where: { id: raced.id } });
    if (changed) {
      const changedReplay = this.resolve(changed, input);
      if (changedReplay) return changedReplay;
    }
    throw IdempotencyService.inProgress();
  }

  async complete<TSnapshot extends Record<string, unknown>>(
    manager: EntityManager,
    input: IdempotencyCompletionInput<TSnapshot>,
  ): Promise<void> {
    const result = await manager.getRepository(IdempotencyRecord).update(
      {
        userId: input.userId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
        status: 'IN_PROGRESS',
      },
      {
        status: 'COMPLETED',
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        responseSnapshot: input.responseSnapshot as never,
        orderId: input.legacyOrderId ?? null,
      },
    );
    if (result.affected !== 1) throw new Error('幂等记录完成失败');
  }

  private resolve<TSnapshot>(
    record: IdempotencyRecord,
    input: IdempotencyResolutionInput<TSnapshot>,
  ): TSnapshot | null {
    if (record.requestHash !== input.requestHash) {
      throw new ConflictException({
        code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
        message: 'Idempotency-Key 与请求内容不一致',
      });
    }
    if (record.status === 'FAILED') return null;
    if (record.status === 'IN_PROGRESS') {
      throw IdempotencyService.inProgress();
    }
    if (
      record.status !== 'COMPLETED' ||
      record.resourceType !== input.resourceType ||
      !record.resourceId ||
      (record.orderId != null && record.orderId !== record.resourceId) ||
      !input.snapshotGuard(record.responseSnapshot, record.resourceId)
    ) {
      throw new Error('幂等记录已损坏');
    }
    return record.responseSnapshot as TSnapshot;
  }

  private static inProgress(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
      message: '相同请求正在处理中',
    });
  }

  private static isUniqueViolation(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'ER_DUP_ENTRY',
    );
  }
}
