import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
} from '@bake-mall/contracts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it, vi } from 'vitest';

import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import { createAdminOperationIdempotencyTestService } from '../../test/helpers/admin-operation-idempotency.js';
import { AdminOperationIdempotencyService } from './admin-operation-idempotency.service.js';
import {
  CloudPrinterReconciliationService,
  normalizeCloudPrinterReconciliationSnapshot,
} from './cloud-printer-reconciliation.service.js';
import type { XpyunVendorPort } from './cloud-printer.service.js';

const ADMIN_ID = '1';
const PASSWORD = 'recovery-password';
const NOW = new Date('2026-08-09T00:00:30.000Z');
let keySequence = 700;
const newKey = (): string =>
  `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

const apiCode = (code: ApiErrorCode) =>
  expect.objectContaining({ response: expect.objectContaining({ code }) });

const basePrinter = (overrides: Partial<CloudPrinter> = {}): CloudPrinter => ({
  id: '1',
  serialNumber: 'SN-Recovery-1',
  displayName: '前台',
  status: CloudPrinterStatus.ERROR,
  bindingStage: PrinterBindingStage.RECONCILIATION,
  vendorRelationState: VendorRelationState.UNKNOWN,
  bindingIdempotencyKey: null,
  bindingOperationId: null,
  verificationCodeHash: null,
  verificationExpiresAt: null,
  verificationFailedAttempts: 0,
  verifiedAt: null,
  lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
  lastStatusCheckedAt: null,
  boundByAdminId: ADMIN_ID,
  boundByAdmin: {} as CloudPrinter['boundByAdmin'],
  lastVendorErrorCode: null,
  unboundAt: null,
  version: 1,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});

type IdempotencyRow = Record<string, unknown> & {
  id: string;
  status: string;
  updatedAt: Date;
};

const matches = (
  row: Readonly<Record<string, unknown>>,
  where: Readonly<Record<string, unknown>>,
): boolean =>
  Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && '_type' in expected) {
      const operator = expected as {
        _type: string;
        _value: unknown;
      };
      if (operator._type === 'in') {
        return (operator._value as unknown[]).includes(actual);
      }
      if (operator._type === 'lessThanOrEqual') {
        return (
          actual instanceof Date &&
          operator._value instanceof Date &&
          actual.getTime() <= operator._value.getTime()
        );
      }
      return true;
    }
    return actual === expected;
  });

const buildFixture = (input?: {
  printers?: CloudPrinter[];
  vendor?: Partial<XpyunVendorPort>;
  advisoryLocks?: Set<string>;
  connectError?: Error;
  getLockError?: Error;
  releaseLockError?: Error;
  runnerReleaseError?: Error;
}) => {
  const transactionContext = new AsyncLocalStorage<boolean>();
  const printers = (input?.printers ?? [basePrinter()]).map((row) => ({
    ...row,
  }));
  const operations: IdempotencyRow[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const advisoryLocks = input?.advisoryLocks ?? new Set<string>();
  const queryRunners: Array<{
    manager: unknown;
    isTransactionActive: boolean;
    startTransaction: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  }> = [];

  const printerRepository = {
    findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = printers.find((candidate) => matches(candidate, where));
      return row ? ({ ...row } as CloudPrinter) : null;
    }),
    find: vi.fn(
      async (options?: {
        where?: Record<string, unknown>;
        take?: number;
        order?: Record<string, 'ASC' | 'DESC'>;
      }) => {
        const sorted = printers
          .filter((row) => !options?.where || matches(row, options.where))
          .sort(
            (left, right) =>
              left.updatedAt.getTime() - right.updatedAt.getTime() ||
              left.id.localeCompare(right.id),
          );
        return sorted
          .slice(0, options?.take ?? sorted.length)
          .map((row) => ({ ...row }));
      },
    ),
    save: vi.fn(async (value: CloudPrinter) => {
      const index = printers.findIndex((row) => row.id === value.id);
      const saved = {
        ...value,
        version: index >= 0 ? printers[index]!.version + 1 : value.version,
        updatedAt: NOW,
      };
      if (index >= 0) printers[index] = saved;
      else printers.push(saved);
      return { ...saved };
    }),
    update: vi.fn(
      async (
        where: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => {
        const found = printers.filter((row) => matches(row, where));
        found.forEach((row) => Object.assign(row, values));
        return { affected: found.length };
      },
    ),
  };

  const idempotencyRepository = {
    insert: vi.fn(async (value: Record<string, unknown>) => {
      if (
        operations.some(
          (row) =>
            row.adminId === value.adminId &&
            row.operation === value.operation &&
            row.key === value.key,
        )
      ) {
        throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      }
      const row = {
        id: String(operations.length + 1),
        createdAt: NOW,
        updatedAt: NOW,
        ...value,
      } as unknown as IdempotencyRow;
      operations.push(row);
      return { identifiers: [{ id: row.id }] };
    }),
    findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = operations.find((candidate) => matches(candidate, where));
      return row ? ({ ...row } as never) : null;
    }),
    find: vi.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        operations
          .filter((row) => matches(row, where))
          .map((row) => ({ ...row })) as never,
    ),
    update: vi.fn(
      async (
        where: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => {
        const found = operations.filter((row) => matches(row, where));
        found.forEach((row) => Object.assign(row, values, { updatedAt: NOW }));
        return { affected: found.length };
      },
    ),
  };

  const getRepository = vi.fn((entity: unknown) =>
    entity === CloudPrinter ? printerRepository : idempotencyRepository,
  );
  const transaction = vi.fn(
    async (run: (manager: unknown) => Promise<unknown>) => {
      const printerSnapshot = structuredClone(printers);
      const operationSnapshot = structuredClone(operations);
      const auditSnapshot = structuredClone(audits);
      try {
        return await transactionContext.run(true, () => run({ getRepository }));
      } catch (error) {
        printers.splice(0, printers.length, ...printerSnapshot);
        operations.splice(0, operations.length, ...operationSnapshot);
        audits.splice(0, audits.length, ...auditSnapshot);
        throw error;
      }
    },
  );
  const makeManager = () => ({ getRepository, transaction });
  const dataSource = {
    getRepository,
    transaction,
    createQueryRunner: vi.fn(() => {
      let heldLock: string | null = null;
      const runner = {
        manager: makeManager(),
        isTransactionActive: false,
        startTransaction: vi.fn(() => {
          runner.isTransactionActive = true;
        }),
        connect: vi.fn(async () => {
          if (input?.connectError) throw input.connectError;
        }),
        release: vi.fn(async () => {
          if (input?.runnerReleaseError) throw input.runnerReleaseError;
        }),
        query: vi.fn(async (sql: string, parameters: string[]) => {
          const lock = parameters[0]!;
          if (sql.includes('GET_LOCK')) {
            if (input?.getLockError) throw input.getLockError;
            if (advisoryLocks.has(lock)) return [{ acquired: 0 }];
            advisoryLocks.add(lock);
            heldLock = lock;
            return [{ acquired: 1 }];
          }
          if (sql.includes('RELEASE_LOCK')) {
            if (heldLock) advisoryLocks.delete(heldLock);
            heldLock = null;
            if (input?.releaseLockError) throw input.releaseLockError;
            return [{ released: 1 }];
          }
          throw new Error(`unexpected SQL: ${sql}`);
        }),
      };
      queryRunners.push(runner);
      return runner;
    }),
  };

  const defaultVendor: XpyunVendorPort = {
    addPrinter: vi.fn(async () => ({ vendorCode: '0', vendorMessage: 'ok' })),
    deletePrinter: vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    })),
    print: vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-1',
    })),
    queryOnline: vi.fn(async () => ({
      status: 'ONLINE' as const,
      vendorCode: '0',
    })),
  };
  const vendor = { ...defaultVendor, ...input?.vendor } as XpyunVendorPort;
  for (const method of Object.values(vendor)) {
    const implementation = (
      method as ReturnType<typeof vi.fn>
    ).getMockImplementation?.();
    if (implementation) {
      (method as ReturnType<typeof vi.fn>).mockImplementation(
        async (...args: unknown[]) => {
          expect(transactionContext.getStore()).toBeUndefined();
          return implementation(...args);
        },
      );
    }
  }

  const verification = {
    verifyPassword: vi.fn(async () => {
      expect(transactionContext.getStore()).toBeUndefined();
      return { status: 'VERIFIED', admin: { id: ADMIN_ID } };
    }),
  };
  const currentPrinters = {
    get: vi.fn(async () => ({
      printer: printers.some(({ id }) => id === '1')
        ? { id: '1', isCurrent: true }
        : null,
      revision: 1,
      updatedAt: NOW.toISOString(),
    })),
    clearByReconciliation: vi.fn(async () => true),
  };
  const audit = {
    record: vi.fn(async (entry: Record<string, unknown>) => {
      expect(transactionContext.getStore()).toBe(true);
      audits.push(structuredClone(entry));
    }),
  };
  const idempotency = createAdminOperationIdempotencyTestService({} as never);
  const service = new CloudPrinterReconciliationService(
    dataSource as never,
    verification as never,
    audit as never,
    idempotency,
    vendor,
    () => NOW,
    currentPrinters as never,
  );
  return {
    service,
    vendor,
    verification,
    printers,
    operations,
    audits,
    currentPrinters,
    transactionContext,
    printerRepository,
    dataSource,
    queryRunners,
  };
};

const vendorError = (
  classification: 'FAILED' | 'UNKNOWN',
  vendorCode?: string,
) =>
  Object.assign(new Error('vendor error'), {
    name: 'XpyunAdapterError',
    classification,
    vendorCode,
  });

const expectTransactionsCommitted = async (
  transaction: ReturnType<typeof vi.fn>,
): Promise<void> => {
  const classificationTransactions = transaction.mock.results
    .slice(0, 2)
    .map((result) => result.value as Promise<unknown>);
  expect(classificationTransactions).toHaveLength(2);
  await expect(Promise.all(classificationTransactions)).resolves.toBeDefined();
};

describe('CloudPrinterReconciliationService administrator recovery', () => {
  it('旧恢复幂等快照缺少 isCurrent 时安全补 false', () => {
    expect(
      normalizeCloudPrinterReconciliationSnapshot({
        printer: {
          id: '1',
          displayName: '前台',
          serialNumberMasked: 'SN****01',
          status: CloudPrinterStatus.UNBOUND,
          onlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
          lastStatusCheckedAt: null,
        },
      }),
    ).toMatchObject({ printer: { isCurrent: false } });
  });

  it('动态投影 current 设备 requery 首次结果与旧快照 replay 的 isCurrent', async () => {
    const key = newKey();
    const fixture = buildFixture();

    const first = await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      key,
    );
    const snapshot = fixture.operations[0]?.responseSnapshot as {
      printer?: { isCurrent?: boolean };
    };
    delete snapshot.printer?.isCurrent;
    const replay = await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      key,
    );

    expect(first.printer.isCurrent).toBe(true);
    expect(replay.printer.isCurrent).toBe(true);
  });

  it('does not start an advisory lock, printer/idempotency transaction, or vendor call when password verification fails', async () => {
    const fixture = buildFixture();
    fixture.verification.verifyPassword.mockRejectedValueOnce(
      new Error('verification rejected'),
    );

    await expect(
      fixture.service.requery(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        newKey(),
      ),
    ).rejects.toThrow('verification rejected');

    expect(fixture.dataSource.transaction).not.toHaveBeenCalled();
    expect(fixture.dataSource.createQueryRunner).not.toHaveBeenCalled();
    expect(fixture.vendor.queryOnline).not.toHaveBeenCalled();
  });

  it('verifies the operation password before printer/idempotency transactions and queries outside transactions', async () => {
    const fixture = buildFixture({
      vendor: {
        queryOnline: vi.fn(async () => ({
          status: 'OFFLINE' as const,
          vendorCode: '0',
        })),
      },
    });

    await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      newKey(),
    );

    expect(fixture.verification.verifyPassword).toHaveBeenCalledWith({
      adminId: ADMIN_ID,
      candidatePassword: PASSWORD,
      now: NOW,
      context: { purpose: 'HIGH_RISK_ACTION' },
    });
    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(1);
    expect(fixture.printers[0]?.vendorRelationState).toBe(
      VendorRelationState.CONFIRMED_BOUND,
    );
  });

  it('does not restore a resend challenge whose print result was not proven successful', async () => {
    const originalKey = newKey();
    const fixture = buildFixture({
      printers: [
        basePrinter({
          bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
          bindingIdempotencyKey: originalKey,
          bindingOperationId: 'resend-unknown',
          verificationCodeHash: 'bcrypt-hash',
          verificationExpiresAt: new Date(NOW.getTime() + 60_000),
          verificationFailedAttempts: 0,
        }),
      ],
    });
    fixture.operations.push({
      id: 'resend-unknown',
      adminId: ADMIN_ID,
      operation: 'CLOUD_PRINTER_RESEND',
      key: originalKey,
      requestHash: 'a'.repeat(64),
      status: 'UNKNOWN',
      resourceType: 'CLOUD_PRINTER',
      resourceId: '1',
      responseSnapshot: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      newKey(),
    );

    expect(fixture.printers[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
    });
    expect(fixture.operations[0]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: { printerId: '1', code: 'RECOVERY_REQUIRED' },
    });
  });

  it.each([
    {
      caseName: 'expired',
      expiresAt: new Date(NOW.getTime() - 1),
      failedAttempts: 0,
    },
    {
      caseName: 'attempts-exhausted',
      expiresAt: new Date(NOW.getTime() + 60_000),
      failedAttempts: 5,
    },
  ])(
    'does not restore an $caseName challenge when vendor ownership is confirmed',
    async ({ expiresAt, failedAttempts }) => {
      const fixture = buildFixture({
        printers: [
          basePrinter({
            verificationCodeHash: 'hash',
            verificationExpiresAt: expiresAt,
            verificationFailedAttempts: failedAttempts,
          }),
        ],
      });

      const result = await fixture.service.requery(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        newKey(),
      );

      expect(result.printer.status).toBe(CloudPrinterStatus.ERROR);
      expect(fixture.printers[0]).toMatchObject({
        status: CloudPrinterStatus.ERROR,
        bindingStage: PrinterBindingStage.RECONCILIATION,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationFailedAttempts: 0,
      });
    },
  );

  it('maps vendor code 1002 to confirmed unbound, clears challenge, and replays without querying again', async () => {
    const key = newKey();
    const fixture = buildFixture({
      printers: [
        basePrinter({
          verificationCodeHash: 'hash',
          verificationExpiresAt: new Date(NOW.getTime() + 60_000),
          verificationFailedAttempts: 2,
        }),
      ],
      vendor: {
        queryOnline: vi.fn(async () => {
          throw vendorError('FAILED', '1002');
        }),
      },
    });

    const first = await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      key,
    );
    const replay = await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      key,
    );

    expect(first.printer.status).toBe(CloudPrinterStatus.UNBOUND);
    expect(replay).toEqual(first);
    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(1);
    expect(fixture.currentPrinters.clearByReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      '1',
    );
    expect(fixture.printers[0]).toMatchObject({
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_UNBOUND,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      unboundAt: NOW,
    });
  });

  it('commits ERROR/UNKNOWN and the recovery operation UNKNOWN before throwing', async () => {
    const fixture = buildFixture({
      vendor: {
        queryOnline: vi.fn(async () => {
          throw vendorError('UNKNOWN');
        }),
      },
    });

    await expect(
      fixture.service.requery(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        newKey(),
      ),
    ).rejects.toMatchObject(apiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN));

    expect(fixture.printers[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.UNKNOWN,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
    });
    expect(fixture.operations[0]).toMatchObject({ status: 'UNKNOWN' });
    await expectTransactionsCommitted(fixture.dataSource.transaction);
  });

  it('same-key requery UNKNOWN can query again and converge its own record without a mutation replay', async () => {
    const key = newKey();
    const queryOnline = vi
      .fn()
      .mockRejectedValueOnce(vendorError('UNKNOWN'))
      .mockResolvedValueOnce({ status: 'OFFLINE' as const, vendorCode: '0' });
    const fixture = buildFixture({ vendor: { queryOnline } });

    await expect(
      fixture.service.requery(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        key,
      ),
    ).rejects.toMatchObject(apiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN));
    const result = await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      key,
    );

    expect(result.printer.onlineStatus).toBe(CloudPrinterOnlineStatus.OFFLINE);
    expect(fixture.operations).toHaveLength(1);
    expect(fixture.operations[0]).toMatchObject({ status: 'COMPLETED' });
    expect(queryOnline).toHaveBeenCalledTimes(2);
    expect(fixture.vendor.addPrinter).not.toHaveBeenCalled();
    expect(fixture.vendor.print).not.toHaveBeenCalled();
    expect(fixture.vendor.deletePrinter).not.toHaveBeenCalled();
  });

  it('supersedes an old requery UNKNOWN after another binding cycle becomes ACTIVE without querying or mutating the new cycle', async () => {
    const key = newKey();
    const queryOnline = vi.fn(async () => {
      throw vendorError('UNKNOWN');
    });
    const fixture = buildFixture({
      printers: [basePrinter({ bindingOperationId: 'old-cycle' })],
      vendor: { queryOnline },
    });

    await expect(
      fixture.service.requery(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        key,
      ),
    ).rejects.toMatchObject(apiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN));
    expect(fixture.operations[0]).toMatchObject({
      status: 'UNKNOWN',
      responseSnapshot: {
        printerId: '1',
        bindingOperationId: 'old-cycle',
      },
    });
    Object.assign(fixture.printers[0]!, {
      status: CloudPrinterStatus.ACTIVE,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingOperationId: 'new-cycle',
      version: fixture.printers[0]!.version + 1,
    });
    const activeCycle = structuredClone(fixture.printers[0]);

    await expect(
      fixture.service.requery(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        key,
      ),
    ).rejects.toMatchObject(
      apiCode(ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED),
    );

    expect(queryOnline).toHaveBeenCalledTimes(1);
    expect(fixture.printers[0]).toEqual(activeCycle);
    expect(fixture.operations[0]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: {
        printerId: '1',
        code: 'RECOVERY_SUPERSEDED',
      },
    });
    expect(fixture.audits).toContainEqual(
      expect.objectContaining({
        changeSummary: expect.objectContaining({
          result: 'RECOVERY_SUPERSEDED',
        }),
      }),
    );
  });

  it('does not let requery vendor evidence mutate a newer binding cycle that appears during vendor I/O', async () => {
    const queryOnline = vi.fn(async () => {
      Object.assign(fixture.printers[0]!, {
        status: CloudPrinterStatus.ACTIVE,
        bindingStage: PrinterBindingStage.NONE,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
        bindingOperationId: 'new-cycle',
        version: fixture.printers[0]!.version + 1,
      });
      return { status: 'OFFLINE' as const, vendorCode: '0' };
    });
    const fixture = buildFixture({
      printers: [basePrinter({ bindingOperationId: 'old-cycle' })],
      vendor: { queryOnline },
    });

    await expect(
      fixture.service.requery(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        newKey(),
      ),
    ).rejects.toMatchObject(
      apiCode(ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED),
    );

    expect(fixture.printers[0]).toMatchObject({
      status: CloudPrinterStatus.ACTIVE,
      bindingOperationId: 'new-cycle',
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
    });
    expect(fixture.operations[0]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: { printerId: '1', code: 'RECOVERY_SUPERSEDED' },
    });
    expect(fixture.audits).toContainEqual(
      expect.objectContaining({
        changeSummary: expect.objectContaining({
          result: 'RECOVERY_SUPERSEDED',
        }),
      }),
    );
  });

  it('same-key requery remains UNKNOWN when read-only relation evidence is still unknown', async () => {
    const key = newKey();
    const fixture = buildFixture({
      vendor: {
        queryOnline: vi.fn(async () => {
          throw vendorError('UNKNOWN');
        }),
      },
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        fixture.service.requery(
          { id: ADMIN_ID },
          '1',
          { operationPassword: PASSWORD },
          key,
        ),
      ).rejects.toMatchObject(apiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN));
    }

    expect(fixture.operations).toHaveLength(1);
    expect(fixture.operations[0]).toMatchObject({ status: 'UNKNOWN' });
    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(2);
  });

  it('converges the current UNKNOWN bind to terminal FAILED when send success was not durably proven', async () => {
    const originalKey = newKey();
    const fixture = buildFixture({
      printers: [
        basePrinter({
          bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
          bindingIdempotencyKey: originalKey,
          bindingOperationId: 'original-1',
          verificationCodeHash: 'bcrypt-hash',
          verificationExpiresAt: new Date(NOW.getTime() + 60_000),
        }),
      ],
    });
    const originalRequest = {
      serialNumber: 'SN-Recovery-1',
      displayName: '前台',
      operationPassword: PASSWORD,
    };
    const idempotency = createAdminOperationIdempotencyTestService({} as never);
    fixture.operations.push({
      id: 'original-1',
      adminId: ADMIN_ID,
      operation: 'CLOUD_PRINTER_BIND',
      key: originalKey,
      requestHash: idempotency.hashRequest(originalRequest),
      status: 'UNKNOWN',
      resourceType: 'CLOUD_PRINTER',
      resourceId: '1',
      responseSnapshot: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      newKey(),
    );

    expect(fixture.operations[0]).toMatchObject({
      operation: 'CLOUD_PRINTER_BIND',
      status: 'FAILED',
      responseSnapshot: { printerId: '1', code: 'RECOVERY_REQUIRED' },
    });
    expect(fixture.vendor.addPrinter).not.toHaveBeenCalled();
    expect(fixture.vendor.print).not.toHaveBeenCalled();
    expect(fixture.vendor.deletePrinter).not.toHaveBeenCalled();

    const manager = {
      getRepository: (
        fixture.dataSource as never as {
          getRepository: (entity: unknown) => unknown;
        }
      ).getRepository,
    };
    const replay = await idempotency.claim(manager as never, {
      adminId: ADMIN_ID,
      operation: 'CLOUD_PRINTER_BIND',
      key: originalKey,
      request: originalRequest,
    });
    expect(replay).toMatchObject({
      kind: 'REPLAY',
      status: 'FAILED',
      responseSnapshot: { printerId: '1', code: 'RECOVERY_REQUIRED' },
    });
    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(1);
  });

  it('does not converge historical, cross-printer, or cross-admin UNKNOWN operations outside the current binding key', async () => {
    const currentKey = newKey();
    const fixture = buildFixture({
      printers: [
        basePrinter({
          bindingIdempotencyKey: currentKey,
          bindingOperationId: 'current',
          bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
          verificationCodeHash: 'bcrypt-hash',
          verificationExpiresAt: new Date(NOW.getTime() + 60_000),
        }),
      ],
    });
    const rows = [
      {
        id: 'current',
        adminId: ADMIN_ID,
        key: currentKey,
        resourceId: '1',
        requestHash: 'a'.repeat(64),
      },
      {
        id: 'historical',
        adminId: ADMIN_ID,
        key: newKey(),
        resourceId: '1',
        requestHash: 'b'.repeat(64),
      },
      {
        id: 'cross-printer',
        adminId: ADMIN_ID,
        key: currentKey,
        resourceId: 'printer-2',
        requestHash: 'c'.repeat(64),
      },
      {
        id: 'cross-admin',
        adminId: '2',
        key: currentKey,
        resourceId: '1',
        requestHash: 'd'.repeat(64),
      },
      {
        id: 'same-key-resend',
        adminId: ADMIN_ID,
        operation: 'CLOUD_PRINTER_RESEND',
        key: currentKey,
        resourceId: '1',
        requestHash: 'e'.repeat(64),
      },
    ];
    for (const row of rows) {
      fixture.operations.push({
        ...row,
        operation: row.operation ?? 'CLOUD_PRINTER_BIND',
        requestHash: row.requestHash,
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        responseSnapshot: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }

    await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      newKey(),
    );

    expect(fixture.operations.find(({ id }) => id === 'current')).toMatchObject(
      {
        status: 'FAILED',
      },
    );
    for (const id of [
      'historical',
      'cross-printer',
      'cross-admin',
      'same-key-resend',
    ]) {
      expect(fixture.operations.find((row) => row.id === id)).toMatchObject({
        status: 'UNKNOWN',
        responseSnapshot: null,
      });
    }
  });

  it('leaves every historical UNKNOWN untouched when the current binding key has no matching record', async () => {
    const fixture = buildFixture({
      printers: [
        basePrinter({
          bindingIdempotencyKey: newKey(),
          bindingOperationId: 'missing-current',
          bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
          verificationCodeHash: 'bcrypt-hash',
          verificationExpiresAt: new Date(NOW.getTime() + 60_000),
        }),
      ],
    });
    fixture.operations.push({
      id: 'historical',
      adminId: ADMIN_ID,
      operation: 'CLOUD_PRINTER_RESEND',
      key: newKey(),
      requestHash: 'e'.repeat(64),
      status: 'UNKNOWN',
      resourceType: 'CLOUD_PRINTER',
      resourceId: '1',
      responseSnapshot: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      newKey(),
    );

    expect(fixture.operations[0]).toMatchObject({
      status: 'UNKNOWN',
      responseSnapshot: null,
    });
  });

  it('rejects a same-key different-hash requery without a second vendor query', async () => {
    const key = newKey();
    const fixture = buildFixture();

    await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      key,
    );

    await expect(
      fixture.service.requery(
        { id: ADMIN_ID },
        '1',
        { operationPassword: `${PASSWORD}-different` },
        key,
      ),
    ).rejects.toMatchObject(apiCode(ApiErrorCode.IDEMPOTENCY_CONFLICT));
    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(1);
  });

  it('confirms compensation deletion once, requires the allowed stage, and records an ADMIN audit without secrets', async () => {
    const key = newKey();
    const fixture = buildFixture({
      printers: [
        basePrinter({ bindingStage: PrinterBindingStage.COMPENSATION_DELETE }),
      ],
    });

    const result = await fixture.service.confirmDeletion(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      key,
    );
    const replay = await fixture.service.confirmDeletion(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      key,
    );

    expect(result.printer.status).toBe(CloudPrinterStatus.UNBOUND);
    expect(replay).toEqual(result);
    expect(fixture.vendor.deletePrinter).toHaveBeenCalledTimes(1);
    const serializedAudit = JSON.stringify(fixture.audits);
    expect(serializedAudit).toContain('ADMIN');
    expect(serializedAudit).toContain(
      'CLOUD_PRINTER_COMPENSATION_DELETE_CONFIRMED',
    );
    expect(serializedAudit).not.toContain('SN-Recovery-1');
    expect(serializedAudit).not.toContain(PASSWORD);
  });

  it('persists a stable FAILED compensation result before throwing and replays without another delete', async () => {
    const key = newKey();
    const fixture = buildFixture({
      printers: [
        basePrinter({ bindingStage: PrinterBindingStage.COMPENSATION_DELETE }),
      ],
      vendor: {
        deletePrinter: vi.fn(async () => {
          throw vendorError('FAILED', '1003');
        }),
      },
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        fixture.service.confirmDeletion(
          { id: ADMIN_ID },
          '1',
          { operationPassword: PASSWORD },
          key,
        ),
      ).rejects.toMatchObject(
        apiCode(ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED),
      );
    }

    expect(fixture.printers[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
      lastVendorErrorCode: '1003',
    });
    expect(fixture.operations[0]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: {
        printerId: '1',
        code: 'RECOVERY_REQUIRED',
      },
    });
    expect(fixture.vendor.deletePrinter).toHaveBeenCalledTimes(1);
    await expectTransactionsCommitted(fixture.dataSource.transaction);
  });

  it('UNBIND_DELETE 只查询厂商关系并在确认已解绑后收敛，不重复 delete', async () => {
    const fixture = buildFixture({
      printers: [
        basePrinter({
          bindingStage: PrinterBindingStage.UNBIND_DELETE,
          vendorRelationState: VendorRelationState.UNKNOWN,
        }),
      ],
      vendor: {
        queryOnline: vi.fn(async () => {
          throw Object.assign(new Error('not bound'), {
            classification: 'FAILED',
            vendorCode: '1002',
          });
        }),
      },
    });

    const result = await fixture.service.confirmDeletion(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      newKey(),
    );

    expect(result.printer).toMatchObject({
      status: CloudPrinterStatus.UNBOUND,
    });
    expect(fixture.printers[0]).toMatchObject({
      status: CloudPrinterStatus.UNBOUND,
      bindingStage: PrinterBindingStage.NONE,
    });
    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(1);
    expect(fixture.vendor.deletePrinter).not.toHaveBeenCalled();
    expect(fixture.operations[0]).toMatchObject({ status: 'COMPLETED' });
  });

  it('does not start a transaction or delete when compensation password verification fails', async () => {
    const fixture = buildFixture({
      printers: [
        basePrinter({ bindingStage: PrinterBindingStage.COMPENSATION_DELETE }),
      ],
    });
    fixture.verification.verifyPassword.mockRejectedValueOnce(
      new Error('verification rejected'),
    );

    await expect(
      fixture.service.confirmDeletion(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        newKey(),
      ),
    ).rejects.toThrow('verification rejected');

    expect(fixture.dataSource.transaction).not.toHaveBeenCalled();
    expect(fixture.dataSource.createQueryRunner).not.toHaveBeenCalled();
    expect(fixture.vendor.deletePrinter).not.toHaveBeenCalled();
  });

  it('allows ERROR with no pending mutation stage to be re-queried as required by the status gate', async () => {
    const fixture = buildFixture({
      printers: [basePrinter({ bindingStage: PrinterBindingStage.NONE })],
    });

    const result = await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      newKey(),
    );

    expect(result.printer.onlineStatus).toBe(CloudPrinterOnlineStatus.ONLINE);
    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['1001', VendorRelationState.UNKNOWN],
    ['1002', VendorRelationState.CONFIRMED_UNBOUND],
    ['1003', VendorRelationState.UNKNOWN],
  ] as const)(
    'persists the relation classification for vendor FAILED code %s',
    async (vendorCode, expectedRelation) => {
      const fixture = buildFixture({
        vendor: {
          queryOnline: vi.fn(async () => {
            throw vendorError('FAILED', vendorCode);
          }),
        },
      });

      const operation = fixture.service.requery(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        newKey(),
      );
      if (expectedRelation === VendorRelationState.UNKNOWN) {
        await expect(operation).rejects.toMatchObject(
          apiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
        );
      } else {
        await expect(operation).resolves.toMatchObject({
          printer: { status: CloudPrinterStatus.UNBOUND },
        });
      }

      expect(fixture.printers[0]?.vendorRelationState).toBe(expectedRelation);
      if (vendorCode === '1001') {
        expect(fixture.printers[0]).toMatchObject({
          status: CloudPrinterStatus.ERROR,
          bindingStage: PrinterBindingStage.RECONCILIATION,
          unboundAt: null,
        });
        expect(fixture.vendor.addPrinter).not.toHaveBeenCalled();
      }
    },
  );

  it('persists delete UNKNOWN before throwing and same-key confirmation queries relation without deleting again', async () => {
    const key = newKey();
    const fixture = buildFixture({
      printers: [
        basePrinter({ bindingStage: PrinterBindingStage.COMPENSATION_DELETE }),
      ],
      vendor: {
        deletePrinter: vi.fn(async () => {
          throw vendorError('UNKNOWN');
        }),
      },
    });

    await expect(
      fixture.service.confirmDeletion(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        key,
      ),
    ).rejects.toMatchObject(apiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN));
    await expect(
      fixture.service.confirmDeletion(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        key,
      ),
    ).rejects.toMatchObject(
      apiCode(ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED),
    );

    expect(fixture.printers[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    });
    expect(fixture.operations[0]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: { printerId: '1', code: 'RECOVERY_REQUIRED' },
    });
    expect(fixture.vendor.deletePrinter).toHaveBeenCalledTimes(1);
    await expectTransactionsCommitted(fixture.dataSource.transaction);
  });

  it.each([
    {
      name: 'confirmed unbound',
      queryOnline: vi.fn(async () => {
        throw vendorError('FAILED', '1002');
      }),
      expectedStatus: 'COMPLETED',
      expectedPrinterStatus: CloudPrinterStatus.UNBOUND,
      expectedApiCode: null,
    },
    {
      name: 'confirmed still bound',
      queryOnline: vi.fn(async () => ({
        status: 'ONLINE' as const,
        vendorCode: '0',
      })),
      expectedStatus: 'FAILED',
      expectedPrinterStatus: CloudPrinterStatus.ERROR,
      expectedApiCode: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
    },
    {
      name: 'still unknown',
      queryOnline: vi.fn(async () => {
        throw vendorError('UNKNOWN');
      }),
      expectedStatus: 'UNKNOWN',
      expectedPrinterStatus: CloudPrinterStatus.ERROR,
      expectedApiCode: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
    },
  ])(
    'same-key delete UNKNOWN reconciles by query only: $name',
    async ({
      queryOnline,
      expectedStatus,
      expectedPrinterStatus,
      expectedApiCode,
    }) => {
      const key = newKey();
      const deletePrinter = vi.fn(async () => {
        throw vendorError('UNKNOWN');
      });
      const fixture = buildFixture({
        printers: [
          basePrinter({
            bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
          }),
        ],
        vendor: { deletePrinter, queryOnline },
      });

      await expect(
        fixture.service.confirmDeletion(
          { id: ADMIN_ID },
          '1',
          { operationPassword: PASSWORD },
          key,
        ),
      ).rejects.toMatchObject(apiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN));
      const retry = fixture.service.confirmDeletion(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        key,
      );
      if (expectedApiCode === null) {
        await expect(retry).resolves.toMatchObject({
          printer: { status: expectedPrinterStatus },
        });
      } else {
        await expect(retry).rejects.toMatchObject(apiCode(expectedApiCode));
      }

      expect(fixture.operations).toHaveLength(1);
      expect(fixture.operations[0]).toMatchObject({ status: expectedStatus });
      expect(fixture.printers[0]).toMatchObject({
        status: expectedPrinterStatus,
      });
      expect(deletePrinter).toHaveBeenCalledTimes(1);
      expect(queryOnline).toHaveBeenCalledTimes(1);
    },
  );

  it('supersedes an old delete UNKNOWN after another binding cycle becomes ACTIVE without querying or deleting again', async () => {
    const key = newKey();
    const deletePrinter = vi.fn(async () => {
      throw vendorError('UNKNOWN');
    });
    const queryOnline = vi.fn(async () => ({
      status: 'ONLINE' as const,
      vendorCode: '0',
    }));
    const fixture = buildFixture({
      printers: [
        basePrinter({
          bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
          bindingOperationId: 'old-cycle',
        }),
      ],
      vendor: { deletePrinter, queryOnline },
    });

    await expect(
      fixture.service.confirmDeletion(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        key,
      ),
    ).rejects.toMatchObject(apiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN));
    Object.assign(fixture.printers[0]!, {
      status: CloudPrinterStatus.ACTIVE,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingOperationId: 'new-cycle',
      version: fixture.printers[0]!.version + 1,
    });
    const activeCycle = structuredClone(fixture.printers[0]);

    await expect(
      fixture.service.confirmDeletion(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        key,
      ),
    ).rejects.toMatchObject(
      apiCode(ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED),
    );

    expect(deletePrinter).toHaveBeenCalledTimes(1);
    expect(queryOnline).not.toHaveBeenCalled();
    expect(fixture.printers[0]).toEqual(activeCycle);
    expect(fixture.operations[0]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: { printerId: '1', code: 'RECOVERY_SUPERSEDED' },
    });
  });

  it('does not let delete vendor outcome mutate a newer binding cycle that appears during vendor I/O', async () => {
    const deletePrinter = vi.fn(async () => {
      Object.assign(fixture.printers[0]!, {
        status: CloudPrinterStatus.ACTIVE,
        bindingStage: PrinterBindingStage.NONE,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
        bindingOperationId: 'new-cycle',
        version: fixture.printers[0]!.version + 1,
      });
      return { vendorCode: '0', vendorMessage: 'ok' };
    });
    const fixture = buildFixture({
      printers: [
        basePrinter({
          bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
          bindingOperationId: 'old-cycle',
        }),
      ],
      vendor: { deletePrinter },
    });

    await expect(
      fixture.service.confirmDeletion(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        newKey(),
      ),
    ).rejects.toMatchObject(
      apiCode(ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED),
    );

    expect(fixture.printers[0]).toMatchObject({
      status: CloudPrinterStatus.ACTIVE,
      bindingOperationId: 'new-cycle',
      unboundAt: null,
    });
    expect(fixture.operations[0]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: { printerId: '1', code: 'RECOVERY_SUPERSEDED' },
    });
  });

  it('rejects a same-key different-hash delete confirmation without another delete', async () => {
    const key = newKey();
    const fixture = buildFixture({
      printers: [
        basePrinter({ bindingStage: PrinterBindingStage.COMPENSATION_DELETE }),
      ],
    });

    await fixture.service.confirmDeletion(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      key,
    );
    await expect(
      fixture.service.confirmDeletion(
        { id: ADMIN_ID },
        '1',
        { operationPassword: `${PASSWORD}-different` },
        key,
      ),
    ).rejects.toMatchObject(apiCode(ApiErrorCode.IDEMPOTENCY_CONFLICT));

    expect(fixture.vendor.deletePrinter).toHaveBeenCalledTimes(1);
  });

  it('converges the precise current UNKNOWN bind to FAILED when bound relation has no usable challenge and leaves resend-eligible state', async () => {
    const currentKey = newKey();
    const fixture = buildFixture({
      printers: [
        basePrinter({
          bindingIdempotencyKey: currentKey,
          bindingOperationId: 'original-bind',
          verificationCodeHash: null,
          verificationExpiresAt: null,
        }),
      ],
    });
    fixture.operations.push({
      id: 'original-bind',
      adminId: 'historical-admin',
      operation: 'CLOUD_PRINTER_BIND',
      key: currentKey,
      requestHash: 'a'.repeat(64),
      status: 'UNKNOWN',
      resourceType: 'CLOUD_PRINTER',
      resourceId: '1',
      responseSnapshot: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      newKey(),
    );

    expect(fixture.operations[0]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: { printerId: '1', code: 'RECOVERY_REQUIRED' },
    });
    expect(fixture.printers[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingOperationId: 'original-bind',
    });
    expect(fixture.vendor.print).not.toHaveBeenCalled();
  });

  it('converges current UNKNOWN resend to FAILED when relation is confirmed unbound', async () => {
    const currentKey = newKey();
    const fixture = buildFixture({
      printers: [
        basePrinter({
          bindingIdempotencyKey: currentKey,
          bindingOperationId: 'original-resend',
        }),
      ],
      vendor: {
        queryOnline: vi.fn(async () => {
          throw vendorError('FAILED', '1002');
        }),
      },
    });
    fixture.operations.push({
      id: 'original-resend',
      adminId: ADMIN_ID,
      operation: 'CLOUD_PRINTER_RESEND',
      key: currentKey,
      requestHash: 'b'.repeat(64),
      status: 'UNKNOWN',
      resourceType: 'CLOUD_PRINTER',
      resourceId: '1',
      responseSnapshot: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await fixture.service.requery(
      { id: ADMIN_ID },
      '1',
      { operationPassword: PASSWORD },
      newKey(),
    );

    expect(fixture.operations[0]).toMatchObject({
      operation: 'CLOUD_PRINTER_RESEND',
      status: 'FAILED',
      responseSnapshot: {
        printerId: '1',
        code: 'RECOVERY_REQUIRED',
      },
    });
    expect(fixture.vendor.print).not.toHaveBeenCalled();
  });

  it('gives concurrent same-printer requery a single vendor owner', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const vendorEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const fixture = buildFixture({
      vendor: {
        queryOnline: vi.fn(async () => {
          entered();
          await barrier;
          return { status: 'ONLINE' as const, vendorCode: '0' };
        }),
      },
    });
    const key = newKey();
    const request = { operationPassword: PASSWORD };

    const owner = fixture.service.requery({ id: ADMIN_ID }, '1', request, key);
    await vendorEntered;
    await expect(
      fixture.service.requery({ id: ADMIN_ID }, '1', request, key),
    ).rejects.toMatchObject(apiCode(ApiErrorCode.IDEMPOTENCY_IN_PROGRESS));
    release();
    await owner;

    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(1);
    expect(fixture.operations).toHaveLength(1);
  });

  it.each(['0', '01', '-1', '1.0', 'printer', '1'.repeat(41)])(
    'rejects invalid or overlong advisory-lock printer id %s before database or vendor work',
    async (printerId) => {
      const fixture = buildFixture();

      await expect(
        fixture.service.requery(
          { id: ADMIN_ID },
          printerId,
          { operationPassword: PASSWORD },
          newKey(),
        ),
      ).rejects.toThrow('打印机 ID 无效');

      expect(fixture.dataSource.createQueryRunner).not.toHaveBeenCalled();
      expect(fixture.dataSource.transaction).not.toHaveBeenCalled();
      expect(fixture.vendor.queryOnline).not.toHaveBeenCalled();
    },
  );

  it('does not record a success audit when terminal idempotency persistence fails', async () => {
    const fixture = buildFixture();
    const idempotency = (
      fixture.service as unknown as {
        idempotencyService: AdminOperationIdempotencyService;
      }
    ).idempotencyService;
    vi.spyOn(idempotency, 'complete').mockRejectedValueOnce(
      new Error('terminal persistence failed'),
    );

    await expect(
      fixture.service.requery(
        { id: ADMIN_ID },
        '1',
        { operationPassword: PASSWORD },
        newKey(),
      ),
    ).rejects.toThrow('terminal persistence failed');

    expect(fixture.audits).toHaveLength(0);
    expect(fixture.printers[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      vendorRelationState: VendorRelationState.UNKNOWN,
    });
    expect(fixture.operations).toHaveLength(1);
    expect(fixture.operations[0]).toMatchObject({
      status: 'IN_PROGRESS',
      responseSnapshot: null,
    });
  });
});

type SchedulerBatchResult = Readonly<{
  processed: number;
  skipped: number;
  unknown: number;
}>;

const runSchedulerBatch = (
  fixture: ReturnType<typeof buildFixture>,
): Promise<SchedulerBatchResult> =>
  (
    fixture.service as unknown as {
      reconcileStaleBatch: () => Promise<SchedulerBatchResult>;
    }
  ).reconcileStaleBatch();

const stalePrinter = (
  sequence: number,
  overrides: Partial<CloudPrinter> = {},
): CloudPrinter =>
  basePrinter({
    id: String(sequence),
    serialNumber: `SN-Scheduler-${sequence}`,
    updatedAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  });

describe('CloudPrinterReconciliationService scheduler batch', () => {
  it('selects only stale BINDING/ERROR printers in updatedAt,id order and caps a batch at 50', async () => {
    const eligible = Array.from({ length: 55 }, (_, index) =>
      stalePrinter(index + 1, {
        status:
          index % 2 === 0
            ? CloudPrinterStatus.BINDING
            : CloudPrinterStatus.ERROR,
        updatedAt: new Date(
          NOW.getTime() - 60_000 + Math.floor(index / 2) * 1_000,
        ),
      }),
    ).reverse();
    const fixture = buildFixture({
      printers: [
        ...eligible,
        stalePrinter(90, { status: CloudPrinterStatus.ACTIVE }),
        stalePrinter(91, { updatedAt: new Date(NOW.getTime() - 29_999) }),
      ],
    });

    const result = await runSchedulerBatch(fixture);

    const expectedOrder = [...eligible]
      .sort(
        (left, right) =>
          left.updatedAt.getTime() - right.updatedAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 50)
      .map((printer) => printer.serialNumber);
    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(50);
    expect(
      vi
        .mocked(fixture.vendor.queryOnline)
        .mock.calls.map(([serial]) => serial),
    ).toEqual(expectedOrder);
    expect(fixture.printerRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        order: { updatedAt: 'ASC', id: 'ASC' },
      }),
    );
    expect(result).toEqual({ processed: 50, skipped: 0, unknown: 0 });
  });

  it('queries relation with vendor I/O outside transactions and never calls add, print, or delete', async () => {
    const fixture = buildFixture({
      printers: [stalePrinter(1), stalePrinter(2)],
    });

    await expect(runSchedulerBatch(fixture)).resolves.toEqual({
      processed: 2,
      skipped: 0,
      unknown: 0,
    });

    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(2);
    expect(fixture.vendor.addPrinter).not.toHaveBeenCalled();
    expect(fixture.vendor.print).not.toHaveBeenCalled();
    expect(fixture.vendor.deletePrinter).not.toHaveBeenCalled();
    expect(fixture.queryRunners).toHaveLength(2);
    for (const runner of fixture.queryRunners) {
      expect(runner.startTransaction).not.toHaveBeenCalled();
      expect(runner.isTransactionActive).toBe(false);
    }
  });

  it('uses one independent classification transaction per acquired printer and keeps prior commits when a later printer fails', async () => {
    const fixture = buildFixture({
      printers: [stalePrinter(1), stalePrinter(2), stalePrinter(3)],
    });
    const originalTransaction =
      fixture.dataSource.transaction.getMockImplementation()!;
    fixture.dataSource.transaction
      .mockImplementationOnce(originalTransaction)
      .mockRejectedValueOnce(new Error('second classification failed'))
      .mockImplementationOnce(originalTransaction);

    const result = await runSchedulerBatch(fixture);

    expect(fixture.dataSource.transaction).toHaveBeenCalledTimes(3);
    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ processed: 2, skipped: 1, unknown: 0 });
    expect(fixture.printers.find(({ id }) => id === '1')).toMatchObject({
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    });
    expect(fixture.printers.find(({ id }) => id === '3')).toMatchObject({
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    });
  });

  it('lets concurrent batches query each printer only once by skipping a held scheduler advisory lock', async () => {
    let releaseVendor!: () => void;
    const vendorBarrier = new Promise<void>((resolve) => {
      releaseVendor = resolve;
    });
    let enteredVendor!: () => void;
    const vendorEntered = new Promise<void>((resolve) => {
      enteredVendor = resolve;
    });
    const fixture = buildFixture({
      printers: [stalePrinter(1)],
      vendor: {
        queryOnline: vi.fn(async () => {
          enteredVendor();
          await vendorBarrier;
          return { status: 'ONLINE' as const, vendorCode: '0' };
        }),
      },
    });

    const owner = runSchedulerBatch(fixture);
    await vendorEntered;
    const concurrent = await runSchedulerBatch(fixture);
    releaseVendor();

    await expect(owner).resolves.toEqual({
      processed: 1,
      skipped: 0,
      unknown: 0,
    });
    expect(concurrent).toEqual({ processed: 0, skipped: 1, unknown: 0 });
    expect(fixture.vendor.queryOnline).toHaveBeenCalledTimes(1);
  });

  it('skips a stale candidate without querying when another batch committed it before this lock was acquired', async () => {
    const fixture = buildFixture({ printers: [stalePrinter(1)] });
    const originalFind =
      fixture.printerRepository.find.getMockImplementation()!;
    fixture.printerRepository.find.mockImplementationOnce(async (...args) => {
      const selected = await originalFind(...args);
      fixture.printers[0]!.version += 1;
      fixture.printers[0]!.updatedAt = NOW;
      return selected;
    });

    await expect(runSchedulerBatch(fixture)).resolves.toEqual({
      processed: 0,
      skipped: 1,
      unknown: 0,
    });
    expect(fixture.vendor.queryOnline).not.toHaveBeenCalled();
  });

  it('uses the shared numeric-printer lock name and releases GET_LOCK when classification throws', async () => {
    const fixture = buildFixture({ printers: [stalePrinter(1)] });
    fixture.dataSource.transaction.mockRejectedValueOnce(
      new Error('classification failed'),
    );

    await expect(runSchedulerBatch(fixture)).resolves.toEqual({
      processed: 0,
      skipped: 1,
      unknown: 0,
    });

    const runner = fixture.queryRunners[0]!;
    expect(runner.query).toHaveBeenNthCalledWith(
      1,
      'SELECT GET_LOCK(?, 0) AS acquired',
      ['bake-mall:cloud-printer:1'],
    );
    expect(runner.query).toHaveBeenNthCalledWith(
      2,
      'SELECT RELEASE_LOCK(?) AS released',
      ['bake-mall:cloud-printer:1'],
    );
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['connect', { connectError: new Error('connect failed') }],
    ['GET_LOCK', { getLockError: new Error('get lock failed') }],
    ['RELEASE_LOCK', { releaseLockError: new Error('release lock failed') }],
  ] as const)(
    'releases the query runner exactly once when %s throws',
    async (_stage, errors) => {
      const fixture = buildFixture({
        printers: [stalePrinter(1)],
        ...errors,
      });

      await expect(runSchedulerBatch(fixture)).resolves.toEqual({
        processed: 0,
        skipped: 1,
        unknown: 0,
      });

      expect(fixture.queryRunners[0]?.release).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the classification failure primary when RELEASE_LOCK also throws', async () => {
    const fixture = buildFixture({
      printers: [stalePrinter(1)],
      releaseLockError: new Error('release lock failed'),
    });
    const operationError = new Error('classification failed');
    fixture.dataSource.transaction.mockRejectedValueOnce(operationError);

    const guarded = (
      fixture.service as unknown as {
        withPrinterAdvisoryLock: <T>(
          printerId: string,
          operation: () => Promise<T>,
          unavailable: 'SKIP',
        ) => Promise<T | null>;
      }
    ).withPrinterAdvisoryLock(
      '1',
      async () => {
        throw operationError;
      },
      'SKIP',
    );

    await expect(guarded).rejects.toBe(operationError);
    expect(fixture.queryRunners[0]?.release).toHaveBeenCalledTimes(1);
  });

  it('counts a printer as skipped when its version changes before classification', async () => {
    const fixture = buildFixture({ printers: [stalePrinter(1)] });
    vi.mocked(fixture.vendor.queryOnline).mockImplementationOnce(async () => {
      fixture.printers[0]!.version += 1;
      return { status: 'ONLINE', vendorCode: '0' };
    });

    await expect(runSchedulerBatch(fixture)).resolves.toEqual({
      processed: 0,
      skipped: 1,
      unknown: 0,
    });
  });

  it('counts unknown relation classifications without aborting the batch', async () => {
    const fixture = buildFixture({
      printers: [stalePrinter(1), stalePrinter(2)],
      vendor: {
        queryOnline: vi
          .fn()
          .mockRejectedValueOnce(vendorError('UNKNOWN'))
          .mockResolvedValueOnce({ status: 'OFFLINE', vendorCode: '0' }),
      },
    });

    await expect(runSchedulerBatch(fixture)).resolves.toEqual({
      processed: 2,
      skipped: 0,
      unknown: 1,
    });
    expect(fixture.printers.find(({ id }) => id === '1')).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      vendorRelationState: VendorRelationState.UNKNOWN,
    });
  });
});
