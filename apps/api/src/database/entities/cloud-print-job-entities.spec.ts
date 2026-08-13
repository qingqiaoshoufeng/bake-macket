import 'reflect-metadata';

import {
  ManualPrintResolution,
  PrintBatchStatus,
  PrintJobStatus,
} from '@bake-mall/contracts';
import { DataSource, type EntityMetadata } from 'typeorm';
import { describe, expect, it } from 'vitest';

import * as entities from './index.js';
import { PrintBatch } from './print-batch.entity.js';
import { PrintJob } from './print-job.entity.js';

const buildMetadata = async (): Promise<{
  batch: EntityMetadata;
  job: EntityMetadata;
}> => {
  const dataSource = new DataSource({
    type: 'mysql',
    database: 'metadata_test',
    entities: Object.values(entities),
  });
  await (
    dataSource as DataSource & { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return {
    batch: dataSource.getMetadata(PrintBatch),
    job: dataSource.getMetadata(PrintJob),
  };
};

const columnsOf = (metadata: EntityMetadata) =>
  Object.fromEntries(
    metadata.columns.map((column) => [column.propertyName, column]),
  );

const indexProperties = (metadata: EntityMetadata, name: string) =>
  metadata.indices
    .find((index) => index.name === name)
    ?.columns.map((column) => column.propertyName);

const relationOf = (metadata: EntityMetadata, propertyName: string) =>
  metadata.relations.find((relation) => relation.propertyName === propertyName);

describe('cloud print batch/job entity metadata', () => {
  it('PrintBatch 映射完整 enum、租约、持久计数和 UTC 时间', async () => {
    const { batch } = await buildMetadata();
    const columns = columnsOf(batch);

    expect(batch.tableName).toBe('print_batches');
    expect(columns.id.type).toBe('bigint');
    expect(columns.id.unsigned).toBe(true);
    expect(columns.printerId.type).toBe('bigint');
    expect(columns.printerId.unsigned).toBe(true);
    expect(columns.createdByAdminId.type).toBe('bigint');
    expect(columns.createdByAdminId.unsigned).toBe(true);
    expect(columns.status.enum).toEqual(Object.values(PrintBatchStatus));
    expect(columns.status.default).toBe(PrintBatchStatus.DRAFT);
    expect(columns.leaseOwner.isNullable).toBe(true);
    expect(columns.leaseExpiresAt.type).toBe('datetime');
    expect(columns.leaseExpiresAt.isNullable).toBe(true);
    for (const counter of [
      'totalCount',
      'classifiedCount',
      'acceptedCount',
      'failedCount',
      'manualReviewCount',
      'manuallyResolvedCount',
      'cancelledCount',
    ]) {
      expect(columns[counter].type).toBe('int');
      expect(columns[counter].unsigned).toBe(true);
      expect(columns[counter].default).toBe(0);
    }
    expect(columns.pendingCount).toBeUndefined();
    expect(columns.submittingCount).toBeUndefined();
    expect(columns.unknownCount).toBeUndefined();
    expect(columns.createdAt.type).toBe('datetime');
    expect(columns.updatedAt.type).toBe('datetime');
    expect(
      batch.checks.find(
        ({ givenName }) => givenName === 'chk_print_batches_classified_count',
      )?.expression,
    ).toBe(
      '`classified_count` = `accepted_count` + `failed_count` + `manually_resolved_count` + `cancelled_count`',
    );
    expect(
      batch.checks.find(
        ({ givenName }) => givenName === 'chk_print_batches_progress_count',
      )?.expression,
    ).toBe('`classified_count` + `manual_review_count` <= `total_count`');
  });

  it('PrintBatch 建立 lease/queue 索引并以 RESTRICT 关联 printer/admin', async () => {
    const { batch } = await buildMetadata();

    expect(indexProperties(batch, 'idx_print_batches_queue')).toEqual([
      'status',
      'leaseExpiresAt',
      'id',
    ]);
    expect(indexProperties(batch, 'idx_print_batches_lease')).toEqual([
      'leaseOwner',
      'leaseExpiresAt',
    ]);
    for (const relation of [
      relationOf(batch, 'printer'),
      relationOf(batch, 'createdByAdmin'),
    ]) {
      expect(relation?.onDelete).toBe('RESTRICT');
      expect(relation?.onUpdate).toBe('RESTRICT');
    }
  });

  it('PrintJob 映射完整 enum、payload、vendor、人工处置及 supersedes 字段', async () => {
    const { job } = await buildMetadata();
    const columns = columnsOf(job);

    expect(job.tableName).toBe('print_jobs');
    for (const foreignId of [
      'batchId',
      'orderId',
      'printerId',
      'createdByAdminId',
    ]) {
      expect(columns[foreignId].type).toBe('bigint');
      expect(columns[foreignId].unsigned).toBe(true);
      expect(columns[foreignId].isNullable).toBe(false);
    }
    expect(columns.sequence.type).toBe('int');
    expect(columns.sequence.unsigned).toBe(true);
    expect(columns.status.enum).toEqual(Object.values(PrintJobStatus));
    expect(columns.status.default).toBe(PrintJobStatus.PENDING);
    expect(columns.payloadJson.type).toBe('json');
    expect(columns.payloadJson.isNullable).toBe(true);
    expect(columns.payloadHash.type).toBe('char');
    expect(columns.payloadHash.length).toBe('64');
    expect(columns.payloadRedactedAt.type).toBe('datetime');
    expect(columns.payloadRedactedAt.isNullable).toBe(true);
    expect(columns.vendorJobId.length).toBe('128');
    expect(columns.vendorJobId.isNullable).toBe(true);
    expect(columns.vendorErrorCode.length).toBe('64');
    expect(columns.vendorErrorCode.isNullable).toBe(true);
    expect(columns.acceptedAt.type).toBe('datetime');
    expect(columns.unknownSinceAt.type).toBe('datetime');
    expect(columns.unknownSinceAt.isNullable).toBe(true);
    expect(columns.unknownQueryCount.type).toBe('int');
    expect(columns.unknownQueryCount.unsigned).toBe(true);
    expect(columns.unknownQueryCount.default).toBe(0);
    expect(columns.lastUnknownQueryAt.type).toBe('datetime');
    expect(columns.lastUnknownQueryAt.isNullable).toBe(true);
    expect(columns.manualResolution.enum).toEqual(
      Object.values(ManualPrintResolution),
    );
    expect(columns.manualResolution.isNullable).toBe(true);
    expect(columns.manualResolutionByAdminId.type).toBe('bigint');
    expect(columns.manualResolutionByAdminId.unsigned).toBe(true);
    expect(columns.manualResolutionByAdminId.isNullable).toBe(true);
    expect(columns.manualResolutionAt.type).toBe('datetime');
    expect(columns.supersedesJobId.type).toBe('bigint');
    expect(columns.supersedesJobId.unsigned).toBe(true);
    expect(columns.supersedesJobId.isNullable).toBe(true);
    expect(columns.idempotencyKey).toBeUndefined();
    expect(columns.createdAt.type).toBe('datetime');
    expect(columns.updatedAt.type).toBe('datetime');
  });

  it('PrintJob 建立双唯一键、queue 索引并以 RESTRICT 关联全部域实体', async () => {
    const { job } = await buildMetadata();

    const batchOrder = job.indices.find(
      ({ name }) => name === 'uniq_print_jobs_batch_order',
    );
    expect(batchOrder?.isUnique).toBe(true);
    expect(batchOrder?.columns.map(({ propertyName }) => propertyName)).toEqual(
      ['batchId', 'orderId'],
    );
    const orderSequence = job.indices.find(
      ({ name }) => name === 'uniq_print_jobs_order_sequence',
    );
    expect(orderSequence?.isUnique).toBe(true);
    expect(
      orderSequence?.columns.map(({ propertyName }) => propertyName),
    ).toEqual(['orderId', 'sequence']);
    expect(indexProperties(job, 'idx_print_jobs_queue')).toEqual([
      'batchId',
      'status',
      'sequence',
    ]);
    for (const relationName of [
      'batch',
      'order',
      'printer',
      'createdByAdmin',
      'manualResolutionByAdmin',
      'supersedesJob',
    ]) {
      const relation = relationOf(job, relationName);
      expect(relation?.onDelete).toBe('RESTRICT');
      expect(relation?.onUpdate).toBe('RESTRICT');
    }
  });
});
