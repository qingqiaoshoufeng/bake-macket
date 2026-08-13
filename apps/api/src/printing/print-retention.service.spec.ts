import { PrintJobStatus } from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PrintJob } from '../database/entities/print-job.entity.js';
import { PrintRetentionService } from './print-retention.service.js';

const CUTOFF = new Date('2026-02-13T00:00:00.000Z');

const setup = () => {
  const jobs = [
    Object.assign(new PrintJob(), {
      id: '1',
      orderId: '10',
      status: PrintJobStatus.UNKNOWN,
      payloadJson: {
        customer: { name: '林女士', phoneMasked: '138****0000' },
        fulfillment: { type: 'DELIVERY', addressText: '完整配送地址' },
        items: [{ productName: '生日蛋糕' }],
        totals: {
          goodsTotalCents: 1_000,
          membershipDiscountCents: 100,
          creditAppliedCents: 200,
          payableTotalCents: 700,
        },
        remark: '顾客备注',
      },
      payloadHash: 'a'.repeat(64),
      payloadRedactedAt: null,
      createdAt: new Date('2026-02-12T23:59:59.000Z'),
    }),
    Object.assign(new PrintJob(), {
      id: '2',
      orderId: '11',
      status: PrintJobStatus.MANUAL_REVIEW,
      payloadJson: {
        totals: {
          goodsTotalCents: 2_000,
          membershipDiscountCents: 0,
          creditAppliedCents: 0,
          payableTotalCents: 2_000,
        },
        remark: '另一个备注',
      },
      payloadHash: 'b'.repeat(64),
      payloadRedactedAt: null,
      createdAt: CUTOFF,
    }),
  ];
  const repository = {
    find: vi.fn(async () => jobs),
    save: vi.fn(async (values: PrintJob[]) => values),
  };
  const manager = {
    getRepository: vi.fn(() => repository),
  };
  const dataSource = {
    transaction: vi.fn(async (work: (value: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new PrintRetentionService(dataSource as never, audit as never);
  return { service, jobs, audit };
};

describe('PrintRetentionService', () => {
  it('清理所有过期状态的 PII，保留原 hash 与整数分汇总', async () => {
    const context = setup();
    const hashes = context.jobs.map(({ payloadHash }) => payloadHash);

    await expect(
      context.service.redactExpiredPayloads(CUTOFF, 100),
    ).resolves.toEqual({ scanned: 2, redacted: 2 });

    expect(context.jobs.map(({ payloadHash }) => payloadHash)).toEqual(hashes);
    expect(JSON.stringify(context.jobs)).not.toMatch(
      /林女士|138\*\*\*\*0000|完整配送地址|生日蛋糕|顾客备注|另一个备注/u,
    );
    expect(context.jobs[0]!.payloadJson).toEqual({
      schemaVersion: 1,
      redacted: true,
      orderId: '10',
      totals: {
        goodsTotalCents: 1_000,
        membershipDiscountCents: 100,
        creditAppliedCents: 200,
        payableTotalCents: 700,
      },
    });
    expect(context.jobs.every(({ payloadRedactedAt }) => payloadRedactedAt)).toBe(
      true,
    );
    expect(context.audit.record).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(context.audit.record.mock.calls)).not.toMatch(
      /完整配送地址|顾客备注|另一个备注/u,
    );
  });
});
