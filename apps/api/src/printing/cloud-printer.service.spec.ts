import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  type ConfirmCloudPrinterResult,
  type RenameCloudPrinterResult,
  type ResendCloudPrinterVerificationResult,
  normalizeCloudPrinterDisplayName,
  normalizeCloudPrinterSerialNumber,
} from '@bake-mall/contracts';
import bcrypt from 'bcrypt';
import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it, vi } from 'vitest';

import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import { AdminOperationIdempotencyService } from './admin-operation-idempotency.service.js';
import { createAdminOperationIdempotencyTestService } from '../../test/helpers/admin-operation-idempotency.js';
import {
  CloudPrinterService,
  toView,
  type XpyunVendorPort,
} from './cloud-printer.service.js';

const ADMIN_ID = '1';

type RecordFixture = Record<string, unknown>;

type FindOperatorFixture = Readonly<{
  _type?: unknown;
  _value?: unknown;
}>;

const matchesWhere = (
  record: Readonly<Record<string, unknown>>,
  where: Readonly<Record<string, unknown>>,
): boolean =>
  Object.entries(where).every(([key, expected]) => {
    const actual = record[key];
    if (expected && typeof expected === 'object' && '_type' in expected) {
      const operator = expected as FindOperatorFixture;
      if (operator._type === 'lessThanOrEqual') {
        return (
          actual instanceof Date &&
          operator._value instanceof Date &&
          actual.getTime() <= operator._value.getTime()
        );
      }
      if (operator._type === 'in') {
        return (operator._value as unknown[]).includes(actual);
      }
    }
    return actual === expected;
  });

const buildVendor = (options: {
  addPrinter?: ReturnType<typeof vi.fn>;
  deletePrinter?: ReturnType<typeof vi.fn>;
  print?: ReturnType<typeof vi.fn>;
  queryOnline?: ReturnType<typeof vi.fn>;
}): XpyunVendorPort => ({
  addPrinter:
    options.addPrinter ??
    vi.fn(async () => ({ vendorCode: '0', vendorMessage: 'ok' })),
  deletePrinter:
    options.deletePrinter ??
    vi.fn(async () => ({ vendorCode: '0', vendorMessage: 'ok' })),
  print:
    options.print ??
    vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-1',
    })),
  queryOnline:
    options.queryOnline ??
    vi.fn(async () => ({ status: 'ONLINE' as const, vendorCode: '0' })),
});

const buildPrinterRepository = (
  existing: CloudPrinter[] = [],
  firstGeneratedId = '1',
) => {
  const rows = existing.map((row) => ({ ...row }));
  let nextId = BigInt(firstGeneratedId);

  const repo = {
    findOne: vi.fn(
      async (options: { where?: Readonly<Record<string, unknown>> } = {}) => {
        const where = options.where ?? {};
        return (
          rows.find((row) =>
            Object.entries(where).every(
              ([key, value]) => row[key as keyof CloudPrinter] === value,
            ),
          ) ?? null
        );
      },
    ),
    find: vi.fn(async () => rows.map((row) => ({ ...row }))),
    create: vi.fn(
      (value: Partial<CloudPrinter>) => ({ ...value }) as CloudPrinter,
    ),
    save: vi.fn(async (value: Partial<CloudPrinter>) => {
      const id = value.id ?? (nextId++).toString();
      const saved = {
        id,
        createdAt: new Date('2026-08-04T00:00:00.000Z'),
        updatedAt: new Date('2026-08-04T00:00:00.000Z'),
        ...value,
      } as CloudPrinter;
      const index = rows.findIndex((row) => row.id === saved.id);
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      return saved;
    }),
    update: vi.fn(
      async (
        where: Readonly<Record<string, unknown>>,
        values: Readonly<Record<string, unknown>>,
      ) => {
        const matching = rows.filter((row) =>
          Object.entries(where).every(
            ([key, value]) => row[key as keyof CloudPrinter] === value,
          ),
        );
        matching.forEach((row) => Object.assign(row, values));
        return { affected: matching.length };
      },
    ),
    count: vi.fn(async () => rows.length),
  };

  return { rows, repo };
};

const buildIdempotencyRepository = () => {
  const records: RecordFixture[] = [];
  const repo = {
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
      async ({ where }: { where: Readonly<Record<string, unknown>> }) =>
        records.find((record) => matchesWhere(record, where)) ?? null,
    ),
    update: vi.fn(
      async (
        where: Readonly<Record<string, unknown>>,
        values: Readonly<Record<string, unknown>>,
      ) => {
        const matching = records.filter((record) =>
          matchesWhere(record, where),
        );
        matching.forEach((record) => Object.assign(record, values));
        return { affected: matching.length };
      },
    ),
  };

  const manager = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === CloudPrinter) return null;
      return repo;
    }),
  };
  return { records, repository: repo, manager };
};

type TransactionState = Readonly<{
  context: AsyncLocalStorage<Readonly<{ active: true }>>;
}>;

const buildDataSource = (
  printerRepo: ReturnType<typeof buildPrinterRepository>['repo'],
  idempotencyRepo: ReturnType<typeof buildIdempotencyRepository>['repository'],
  transactionState: TransactionState = {
    context: new AsyncLocalStorage<Readonly<{ active: true }>>(),
  },
) => {
  const getRepository = vi.fn((entity: unknown) => {
    if (entity === CloudPrinter) return printerRepo;
    return idempotencyRepo;
  });
  return {
    getRepository,
    transaction: vi.fn(
      async (operation: (manager: unknown) => Promise<unknown>) =>
        transactionState.context.run({ active: true }, () =>
          operation({ getRepository }),
        ),
    ),
  } as never;
};

let idempotencyKeySequence = 0;
const newIdempotencyKey = (): string =>
  `00000000-0000-4000-8000-${String(++idempotencyKeySequence).padStart(12, '0')}`;

const hashChallengeFixture = (code: string): Promise<string> =>
  bcrypt.hash(code, 4);

const confirmPrinterFixture = async (
  id: string,
  serialNumber: string,
  code = '654321',
): Promise<CloudPrinter> =>
  ({
    id,
    serialNumber,
    displayName: '前台',
    status: CloudPrinterStatus.PENDING_VERIFICATION,
    bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
    vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    bindingIdempotencyKey: null,
    verificationCodeHash: await hashChallengeFixture(code),
    verificationExpiresAt: new Date('2026-08-04T00:05:00.000Z'),
    verificationFailedAttempts: 0,
    verifiedAt: null,
    lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
    lastStatusCheckedAt: null,
    boundByAdminId: ADMIN_ID,
    lastVendorErrorCode: null,
    unboundAt: null,
    version: 1,
  }) as CloudPrinter;

const firstPrintInput = (
  print: ReturnType<typeof vi.fn>,
): Parameters<XpyunVendorPort['print']>[0] => {
  const call = (
    print.mock.calls as unknown as Array<Parameters<XpyunVendorPort['print']>>
  )[0];
  if (!call) throw new Error('Expected a vendor print call.');
  return call[0];
};

const expectApiCode = (code: ApiErrorCode) =>
  expect.objectContaining({ response: expect.objectContaining({ code }) });

const serviceInternals = (service: CloudPrinterService) =>
  service as unknown as {
    dataSource: {
      transaction: ReturnType<typeof vi.fn>;
    };
    verification: {
      verifyPassword: ReturnType<typeof vi.fn>;
    };
    audit: {
      record: ReturnType<typeof vi.fn>;
    };
  };

const expectClassificationTransactionsCommitted = async (
  service: CloudPrinterService,
): Promise<void> => {
  const transaction = serviceInternals(service).dataSource.transaction;
  const results = transaction.mock.results.map(
    (result) => result.value as Promise<unknown>,
  );
  await expect(Promise.all(results)).resolves.toBeDefined();
};

const buildService = (options: {
  vendor?: XpyunVendorPort;
  repository: ReturnType<typeof buildPrinterRepository>;
  idempotencyRepository: ReturnType<
    typeof buildIdempotencyRepository
  >['repository'];
  now?: () => Date;
}) => {
  const transactionState: TransactionState = {
    context: new AsyncLocalStorage<Readonly<{ active: true }>>(),
  };
  const dataSource = buildDataSource(
    options.repository.repo,
    options.idempotencyRepository,
    transactionState,
  );
  const vendor = options.vendor ?? buildVendor({});
  for (const operation of [
    vendor.addPrinter,
    vendor.deletePrinter,
    vendor.print,
    vendor.queryOnline,
  ] as Array<ReturnType<typeof vi.fn>>) {
    const implementation = operation.getMockImplementation();
    operation.mockImplementation(async (...args: unknown[]) => {
      expect(transactionState.context.getStore()).toBeUndefined();
      return implementation!(...args);
    });
  }
  return new CloudPrinterService(
    dataSource as never,
    {
      verifyPassword: vi.fn(async () => {
        expect(transactionState.context.getStore()).toBeUndefined();
        return {
          status: 'VERIFIED' as const,
          admin: { id: ADMIN_ID } as never,
        };
      }),
    } as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
    createAdminOperationIdempotencyTestService({} as never),
    vendor,
    options.now ?? (() => new Date('2026-08-04T00:00:00.000Z')),
    {
      verificationWindowMs: 5 * 60 * 1000,
      verificationMaxAttempts: 5,
      onlineStatusCacheMs: 30 * 1000,
      verificationCodeBcryptCost: 4,
    },
  );
};

const buildServiceWithManager = (options: {
  vendor?: XpyunVendorPort;
  repository: ReturnType<typeof buildPrinterRepository>;
  idempotencyRepository: ReturnType<
    typeof buildIdempotencyRepository
  >['repository'];
  now?: () => Date;
}) => {
  return {
    service: buildService(options),
    repository: options.repository,
    idempotencyRepository: options.idempotencyRepository,
  };
};

describe('CloudPrinterService.bind', () => {
  const SERIAL = 'SN-BindTest-1';
  const DISPLAY_NAME = '前台';

  it.each([
    ['SN_BadChar', '前台'],
    ['SN Has Space', '前台'],
    ['', '前台'],
    [SERIAL, ''],
    [SERIAL, '   '],
    [SERIAL, 'a'.repeat(65)],
  ])('rejects invalid input %j', async (serialNumber, displayName) => {
    const { service } = buildServiceWithManager({
      repository: buildPrinterRepository(),
      idempotencyRepository: buildIdempotencyRepository().repository,
    });

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        { serialNumber, displayName, operationPassword: 'pw' },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expect.objectContaining({
        response: expect.objectContaining({
          code: expect.stringMatching(/.+/u),
        }),
      }),
    );
  });

  it('follows state machine db:BINDING → vendor:add → db:challenge → vendor:print-code → db:PENDING_VERIFICATION', async () => {
    const callTrace: string[] = [];
    const addPrinter = vi.fn(async () => {
      callTrace.push('vendor:add');
      return { vendorCode: '0', vendorMessage: 'ok' };
    });
    const print = vi.fn(async () => {
      callTrace.push('vendor:print-code');
      return {
        classification: 'ACCEPTED' as const,
        vendorCode: '0',
        vendorJobId: 'job-1',
      };
    });
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const originalInsert = idempotencyRepository.insert.getMockImplementation();
    idempotencyRepository.insert.mockImplementation(
      async (value: RecordFixture) => {
        const status = value.status as string;
        if (status === 'IN_PROGRESS') callTrace.push('db:BINDING');
        return (originalInsert ?? (async () => ({ identifiers: [] })))(value);
      },
    );
    const originalSave = repository.repo.save.getMockImplementation();
    repository.repo.save.mockImplementation(
      async (value: Partial<CloudPrinter>) => {
        const stage = (value as { bindingStage?: PrinterBindingStage })
          .bindingStage;
        if (stage === PrinterBindingStage.PRINT_VERIFICATION_CODE) {
          callTrace.push('db:challenge');
        }
        if (stage === PrinterBindingStage.NONE) {
          callTrace.push('db:PENDING_VERIFICATION');
        }
        return (originalSave ?? (async () => ({}) as CloudPrinter))(value);
      },
    );

    const vendor = buildVendor({ addPrinter, print });
    const { service } = buildServiceWithManager({
      vendor,
      repository,
      idempotencyRepository,
    });

    const result = await service.bind(
      { id: ADMIN_ID } as never,
      {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'pw',
      },
      newIdempotencyKey(),
    );

    expect(callTrace).toEqual([
      'db:BINDING',
      'vendor:add',
      'db:challenge',
      'vendor:print-code',
      'db:PENDING_VERIFICATION',
    ]);
    expect(result.challenge.remainingAttempts).toBe(5);
    expect(repository.rows[0]?.bindingOperationId).toBe(
      String(idempotencyRepository.insert.mock.results.length),
    );
    expect(repository.rows[0]?.bindingIdempotencyKey).toBe(
      idempotencyRepository.insert.mock.calls[0]?.[0].key,
    );
    expect(addPrinter).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
    expect(firstPrintInput(print).tradeOrderId).toMatch(
      /^cp-.+-[a-f0-9]{32}$/u,
    );
    expect(firstPrintInput(print).tradeOrderId.length).toBeLessThanOrEqual(50);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SERIAL);
    expect(serialized).not.toContain('top-secret-key');
  });

  it('stores a salted bcrypt challenge outside transactions without plaintext or precomputable SHA-256', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-bcrypt',
    }));
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ print }),
      repository,
      idempotencyRepository,
    });

    await service.bind(
      { id: ADMIN_ID } as never,
      {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'pw',
      },
      newIdempotencyKey(),
    );

    const code = firstPrintInput(print).content.replace('ownership-code:', '');
    const stored = repository.rows[0]?.verificationCodeHash;
    expect(stored).toMatch(/^\$2[aby]\$04\$/u);
    expect(stored).not.toContain(code);
    expect(stored).not.toBe(
      await import('node:crypto').then(({ createHash }) =>
        createHash('sha256')
          .update(`bake-mall:cloud-printer:v1:${code}`)
          .digest('hex'),
      ),
    );
    await expect(bcrypt.compare(code, stored!)).resolves.toBe(true);
  });

  it('keeps the vendor idempotent within 50 characters at the maximum BIGINT id', async () => {
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-1',
    }));
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ print }),
      repository: buildPrinterRepository([], '18446744073709551615'),
      idempotencyRepository: buildIdempotencyRepository().repository,
    });

    await service.bind(
      { id: ADMIN_ID } as never,
      {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'pw',
      },
      newIdempotencyKey(),
    );

    expect(firstPrintInput(print).tradeOrderId).toMatch(
      /^cp-[a-z0-9]+-[a-f0-9]{32}$/u,
    );
    expect(firstPrintInput(print).tradeOrderId.length).toBeLessThanOrEqual(50);
  });

  it('bind 将完整 SN、操作密码与本次明文验证码传入 snapshot 校验路径', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-sensitive-bind',
    }));
    const service = buildService({
      repository,
      idempotencyRepository,
      vendor: buildVendor({ print }),
    });
    const idempotency = (
      service as unknown as {
        idempotencyService: AdminOperationIdempotencyService;
      }
    ).idempotencyService;
    const complete = vi.spyOn(idempotency, 'complete');

    await service.bind(
      { id: ADMIN_ID } as never,
      {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'bind-secret',
      },
      newIdempotencyKey(),
    );

    const challengePlaintext = firstPrintInput(print).content.replace(
      'ownership-code:',
      '',
    );
    expect(complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sensitiveValues: [SERIAL, 'bind-secret', challengePlaintext],
      }),
    );
  });

  it('does not expose the verification code in responses or logs', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const { service } = buildServiceWithManager({
      vendor: buildVendor({}),
      repository,
      idempotencyRepository,
    });

    const result = await service.bind(
      { id: ADMIN_ID } as never,
      {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'pw',
      },
      newIdempotencyKey(),
    );

    const serialized = JSON.stringify(result);
    // The verification code is hashed; never returned in plaintext.
    expect(serialized).not.toMatch(/\bcode\b\s*:\s*['"]?\d{4,}/u);
    expect(serialized).not.toMatch(/challengeId\s*:\s*['"]\d/u);
  });

  it.each([SERIAL, `前台-${SERIAL.toLowerCase()}-设备`])(
    'rejects a display name containing the full serial before claim, vendor, or mutation: %s',
    async (displayName) => {
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      const vendor = buildVendor({});
      const { service } = buildServiceWithManager({
        vendor,
        repository,
        idempotencyRepository: idempotency.repository,
      });

      await expect(
        service.bind(
          { id: ADMIN_ID } as never,
          { serialNumber: SERIAL, displayName, operationPassword: 'pw' },
          newIdempotencyKey(),
        ),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.CLOUD_PRINTER_NAME_INVALID),
      );

      expect(idempotency.records).toHaveLength(0);
      expect(repository.repo.save).not.toHaveBeenCalled();
      expect(vendor.addPrinter).not.toHaveBeenCalled();
      expect(serviceInternals(service).audit.record).not.toHaveBeenCalled();
    },
  );

  it('allows a short serial in an ordinary bind display name and preserves the view name', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository,
    });

    const result = await service.bind(
      { id: ADMIN_ID } as never,
      { serialNumber: 'A', displayName: 'Cake Shop', operationPassword: 'pw' },
      newIdempotencyKey(),
    );

    expect(result.printer.displayName).toBe('Cake Shop');
    expect(toView(repository.rows[0]!)).toMatchObject({
      displayName: 'Cake Shop',
    });
  });

  it('rejects a short serial only when the trimmed display name equals it', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const vendor = buildVendor({});
    const { service } = buildServiceWithManager({
      vendor,
      repository,
      idempotencyRepository,
    });

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        { serialNumber: 'A', displayName: ' A ', operationPassword: 'pw' },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_NAME_INVALID),
    );
    expect(idempotencyRepository.insert).not.toHaveBeenCalled();
    expect(vendor.addPrinter).not.toHaveBeenCalled();
  });

  it('does not reject or fallback a dirty short serial name containing the serial', () => {
    const printer = {
      serialNumber: 'A',
      displayName: 'Printer A',
    } as CloudPrinter;

    expect(toView(printer).displayName).toBe('Printer A');
    expect(toView({ ...printer, displayName: ' A ' }).displayName).toBe(
      '打印机 *',
    );
  });

  it('rejects a long serial embedded in a bind display name', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const vendor = buildVendor({});
    const { service } = buildServiceWithManager({
      vendor,
      repository,
      idempotencyRepository,
    });
    const serialNumber = 'SN-Long-12345';

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber,
          displayName: `前台-${serialNumber.toLowerCase()}-设备`,
          operationPassword: 'pw',
        },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_NAME_INVALID),
    );
    expect(idempotencyRepository.insert).not.toHaveBeenCalled();
    expect(vendor.addPrinter).not.toHaveBeenCalled();
  });

  it.each([
    ['', ApiErrorCode.CLOUD_PRINTER_NAME_INVALID],
    ['   ', ApiErrorCode.CLOUD_PRINTER_NAME_INVALID],
    ['😀'.repeat(65), ApiErrorCode.CLOUD_PRINTER_NAME_INVALID],
  ] as const)(
    'uses NAME_INVALID for bind name %j',
    async (displayName, code) => {
      const repository = buildPrinterRepository();
      const idempotencyRepository = buildIdempotencyRepository().repository;
      const { service } = buildServiceWithManager({
        repository,
        idempotencyRepository,
      });

      await expect(
        service.bind(
          { id: ADMIN_ID } as never,
          { serialNumber: SERIAL, displayName, operationPassword: 'pw' },
          newIdempotencyKey(),
        ),
      ).rejects.toMatchObject(expectApiCode(code));
    },
  );

  it('allows a short serial in an ordinary rename name and rejects exact serial rename', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    repository.rows.push({
      id: 'printer-short-rename',
      serialNumber: 'A',
      displayName: '旧名',
      status: CloudPrinterStatus.ACTIVE,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: new Date(),
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    } as CloudPrinter);
    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository,
    });

    const renamed = await service.rename(
      { id: ADMIN_ID } as never,
      'printer-short-rename',
      { displayName: 'Printer A' },
      newIdempotencyKey(),
    );
    expect(renamed.printer.displayName).toBe('Printer A');

    await expect(
      service.rename(
        { id: ADMIN_ID } as never,
        'printer-short-rename',
        { displayName: 'A' },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_NAME_INVALID),
    );
  });

  it('uses NAME_INVALID for rename Unicode boundary and does not claim or audit', async () => {
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    repository.rows.push({
      id: 'printer-name-boundary',
      serialNumber: 'SN-Name-Boundary',
      displayName: '旧名',
      status: CloudPrinterStatus.ACTIVE,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: new Date(),
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    } as CloudPrinter);
    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository: idempotency.repository,
    });

    await expect(
      service.rename(
        { id: ADMIN_ID } as never,
        'printer-name-boundary',
        { displayName: '😀'.repeat(65) },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_NAME_INVALID),
    );
    expect(idempotency.records).toHaveLength(0);
    expect(repository.repo.save).not.toHaveBeenCalled();
    expect(serviceInternals(service).audit.record).not.toHaveBeenCalled();
  });

  it('maps stable add vendor failures and replays the same HTTP error without a second vendor call', async () => {
    const cases = [
      ['1010', 400, ApiErrorCode.CLOUD_PRINTER_SERIAL_INVALID],
      ['1001', 409, ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT],
      ['1022', 409, ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT],
      ['1033', 409, ApiErrorCode.CLOUD_PRINTER_VENDOR_LIMIT],
      ['1003', 409, ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED],
    ] as const;

    for (const [vendorCode, httpStatus, apiCode] of cases) {
      const addPrinter = vi.fn(async () => {
        throw Object.assign(new Error('raw vendor message'), {
          classification: 'FAILED',
          vendorCode,
        });
      });
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      const { service } = buildServiceWithManager({
        vendor: buildVendor({ addPrinter }),
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const key = newIdempotencyKey();
      const first = await service
        .bind(
          { id: ADMIN_ID } as never,
          {
            serialNumber: SERIAL,
            displayName: DISPLAY_NAME,
            operationPassword: 'pw',
          },
          key,
        )
        .catch(
          (error: unknown) => error as { response?: unknown; status?: number },
        );
      const second = await service
        .bind(
          { id: ADMIN_ID } as never,
          {
            serialNumber: SERIAL,
            displayName: DISPLAY_NAME,
            operationPassword: 'pw',
          },
          key,
        )
        .catch(
          (error: unknown) => error as { response?: unknown; status?: number },
        );

      expect(first).toMatchObject({
        status: httpStatus,
        response: { code: apiCode },
      });
      expect(second).toMatchObject({
        status: httpStatus,
        response: (first as { response: unknown }).response,
      });
      expect(addPrinter).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(idempotency.records[0])).not.toContain(
        'raw vendor message',
      );
      expect(JSON.stringify(idempotency.records[0])).not.toContain(SERIAL);
    }
  });

  it.each([
    ['RATE_LIMITED', 429, ApiErrorCode.CLOUD_PRINTER_VENDOR_RATE_LIMITED],
    ['UNAVAILABLE', 503, ApiErrorCode.CLOUD_PRINTER_VENDOR_UNAVAILABLE],
  ] as const)(
    'maps add %s to a stable shared API error without leaking vendor details',
    async (classification, httpStatus, apiCode) => {
      const addPrinter = vi.fn(async () => {
        throw Object.assign(
          new Error(`raw ${classification} ${SERIAL} vendor-secret`),
          {
            classification,
            vendorCode: '9999',
          },
        );
      });
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      const { service } = buildServiceWithManager({
        vendor: buildVendor({ addPrinter }),
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const key = newIdempotencyKey();
      const request = {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'operation-secret',
      };

      const first = await service
        .bind({ id: ADMIN_ID } as never, request, key)
        .catch(
          (error: unknown) => error as { response?: unknown; status?: number },
        );
      const second = await service
        .bind({ id: ADMIN_ID } as never, request, key)
        .catch(
          (error: unknown) => error as { response?: unknown; status?: number },
        );

      expect(first).toMatchObject({
        status: httpStatus,
        response: { code: apiCode },
      });
      expect(second).toMatchObject({
        status: httpStatus,
        response: (first as { response: unknown }).response,
      });
      expect(addPrinter).toHaveBeenCalledTimes(1);
      expect(idempotency.records[0]).toMatchObject({
        status: 'FAILED',
        responseSnapshot: {
          printerId: repository.rows[0]?.id,
          code:
            classification === 'RATE_LIMITED'
              ? 'VENDOR_RATE_LIMITED'
              : 'VENDOR_UNAVAILABLE',
        },
      });
      expect(JSON.stringify(first)).not.toMatch(
        new RegExp(`${SERIAL}|operation-secret|vendor-secret|raw`, 'u'),
      );
      expect(JSON.stringify(idempotency.records[0])).not.toMatch(
        new RegExp(`${SERIAL}|operation-secret|vendor-secret|raw`, 'u'),
      );
    },
  );

  it('keeps add transport and timeout UNKNOWN rather than stable FAILED', async () => {
    const addPrinter = vi.fn(async () => {
      throw Object.assign(new Error('timeout'), {
        classification: 'UNKNOWN',
        vendorCode: undefined,
      });
    });
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter }),
      repository,
      idempotencyRepository: idempotency.repository,
    });

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );
    expect(idempotency.records[0]).toMatchObject({ status: 'UNKNOWN' });
  });

  it('requires an Idempotency-Key', async () => {
    const { service } = buildServiceWithManager({
      repository: buildPrinterRepository(),
      idempotencyRepository: buildIdempotencyRepository().repository,
    });

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        '',
      ),
    ).rejects.toMatchObject(
      expect.objectContaining({
        response: expect.objectContaining({ code: expect.any(String) }),
      }),
    );
  });

  it('replays same-key same-hash without reissuing vendor calls', async () => {
    const addPrinter = vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    }));
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-1',
    }));
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, print }),
      repository,
      idempotencyRepository,
    });
    const key = newIdempotencyKey();

    const first = await service.bind(
      { id: ADMIN_ID } as never,
      {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'pw',
      },
      key,
    );

    // Replay must NOT cause a second vendor call.
    addPrinter.mockClear();
    print.mockClear();

    const second = await service.bind(
      { id: ADMIN_ID } as never,
      {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'pw',
      },
      key,
    );

    expect(addPrinter).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    expect(second.printer.id).toBe(first.printer.id);
  });

  it('rejects same-key different-hash as idempotency conflict', async () => {
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const { service } = buildServiceWithManager({
      repository: buildPrinterRepository(),
      idempotencyRepository,
    });
    const key = newIdempotencyKey();

    await service.bind(
      { id: ADMIN_ID } as never,
      {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'pw',
      },
      key,
    );

    expect(idempotencyRepository.insert).toHaveBeenCalledTimes(1);
    const insertedClaim = idempotencyRepository.insert.mock.calls[0]?.[0];
    expect(insertedClaim).not.toHaveProperty('ownerTokenHash');

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: 'SN-Different-99',
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        key,
      ),
    ).rejects.toMatchObject(expectApiCode(ApiErrorCode.IDEMPOTENCY_CONFLICT));
  });

  it('keeps one owner for overlapping same-key claims and returns a stable loser', async () => {
    let releaseFirstInsert!: () => void;
    let markFirstInsertEntered!: () => void;
    const firstInsertEntered = new Promise<void>((resolve) => {
      markFirstInsertEntered = resolve;
    });
    const firstInsertReleased = new Promise<void>((resolve) => {
      releaseFirstInsert = resolve;
    });
    const addPrinter = vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    }));
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-1',
    }));
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const originalInsert =
      idempotency.repository.insert.getMockImplementation();
    let insertCalls = 0;
    idempotency.repository.insert.mockImplementation(
      async (value: RecordFixture) => {
        insertCalls += 1;
        if (insertCalls === 1) {
          markFirstInsertEntered();
          await firstInsertReleased;
        }
        return originalInsert!(value);
      },
    );
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, print }),
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const key = newIdempotencyKey();
    const request = {
      serialNumber: SERIAL,
      displayName: DISPLAY_NAME,
      operationPassword: 'pw',
    };

    const first = service.bind({ id: ADMIN_ID } as never, request, key);
    await firstInsertEntered;
    const second = service.bind({ id: ADMIN_ID } as never, request, key);
    await Promise.resolve();
    releaseFirstInsert();
    const outcomes = await Promise.allSettled([first, second]);

    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(idempotency.records).toHaveLength(1);
    expect(idempotency.records[0]).toMatchObject({ status: 'COMPLETED' });
    expect(addPrinter).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('compensates vendor failure by transitioning to UNBOUND', async () => {
    const addPrinter = vi.fn(async () => {
      throw Object.assign(new Error('rejected'), {
        name: 'XpyunAdapterError',
        classification: 'FAILED',
        vendorCode: '1003',
      });
    });
    const deletePrinter = vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    }));
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-1',
    }));
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, deletePrinter, print }),
      repository,
      idempotencyRepository,
    });

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expect.objectContaining({
        response: expect.objectContaining({
          code: ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED,
        }),
      }),
    );

    expect(deletePrinter).not.toHaveBeenCalled();
    const stored = repository.rows[0];
    expect(stored?.status).toBe(CloudPrinterStatus.UNBOUND);
    expect(stored?.unboundAt).toBeInstanceOf(Date);
  });

  it('rejects an existing vendor relation after an earlier explicit add failure without proven ownership', async () => {
    const addPrinter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('rejected'), {
          name: 'XpyunAdapterError',
          classification: 'FAILED',
          vendorCode: '1003',
        }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('exists'), {
          name: 'XpyunAdapterError',
          classification: 'FAILED',
          vendorCode: '1011',
        }),
      );
    const queryOnline = vi.fn(async () => ({
      status: 'ABNORMAL' as const,
      vendorCode: '0',
    }));
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-unproven-ownership',
    }));
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, queryOnline, print }),
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const request = {
      serialNumber: SERIAL,
      displayName: DISPLAY_NAME,
      operationPassword: 'ownership-secret',
    };

    await expect(
      service.bind({ id: ADMIN_ID } as never, request, newIdempotencyKey()),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED),
    );
    expect(repository.rows[0]).toMatchObject({
      status: CloudPrinterStatus.UNBOUND,
      verifiedAt: null,
    });
    expect(repository.rows[0]?.bindingIdempotencyKey).toEqual(
      expect.any(String),
    );

    await expect(
      service.bind({ id: ADMIN_ID } as never, request, newIdempotencyKey()),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT),
    );

    expect(addPrinter).toHaveBeenCalledTimes(2);
    expect(queryOnline).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.UNKNOWN,
      verificationCodeHash: null,
      verifiedAt: null,
    });
    expect(idempotency.records).toHaveLength(2);
    expect(idempotency.records[1]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: {
        printerId: repository.rows[0]?.id,
        code: 'OWNERSHIP_CONFLICT',
      },
    });
  });

  it('preserves historical ownership across an explicit add failure and recovers an existing vendor relation on the next bind', async () => {
    const historicalVerifiedAt = new Date('2026-07-31T00:00:00.000Z');
    const addPrinter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('rejected'), {
          name: 'XpyunAdapterError',
          classification: 'FAILED',
          vendorCode: '1003',
        }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('exists'), {
          name: 'XpyunAdapterError',
          classification: 'FAILED',
          vendorCode: '1011',
        }),
      );
    const queryOnline = vi.fn(async () => ({
      status: 'ABNORMAL' as const,
      vendorCode: '0',
    }));
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-historical-ownership-recovery',
    }));
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const existing = await repository.repo.save({
      serialNumber: SERIAL,
      displayName: '历史设备',
      status: CloudPrinterStatus.UNBOUND,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_UNBOUND,
      bindingIdempotencyKey: 'historical-key',
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: historicalVerifiedAt,
      lastOnlineStatus: CloudPrinterOnlineStatus.OFFLINE,
      lastStatusCheckedAt: new Date('2026-08-01T00:00:00.000Z'),
      boundByAdminId: 'historical-admin',
      lastVendorErrorCode: null,
      unboundAt: new Date('2026-08-01T00:00:00.000Z'),
      version: 1,
    } as Partial<CloudPrinter>);
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, queryOnline, print }),
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const request = {
      serialNumber: SERIAL,
      displayName: DISPLAY_NAME,
      operationPassword: 'historical-ownership-secret',
    };

    await expect(
      service.bind({ id: ADMIN_ID } as never, request, newIdempotencyKey()),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED),
    );
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]).toMatchObject({
      id: existing.id,
      status: CloudPrinterStatus.UNBOUND,
      verifiedAt: historicalVerifiedAt,
    });

    const recovered = await service.bind(
      { id: ADMIN_ID } as never,
      request,
      newIdempotencyKey(),
    );

    expect(recovered.printer).toMatchObject({
      id: existing.id,
      status: CloudPrinterStatus.PENDING_VERIFICATION,
    });
    expect(recovered.printer).not.toHaveProperty('verifiedAt');
    expect(addPrinter).toHaveBeenCalledTimes(2);
    expect(queryOnline).toHaveBeenCalledTimes(1);
    expect(queryOnline).toHaveBeenCalledWith(SERIAL);
    expect(print).toHaveBeenCalledTimes(1);
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]).toMatchObject({
      id: existing.id,
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      verifiedAt: historicalVerifiedAt,
    });
  });

  it('preserves historical ownership when a committed bind intent is followed by an UNKNOWN add outcome', async () => {
    const historicalVerifiedAt = new Date('2026-07-31T00:00:00.000Z');
    const repository = buildPrinterRepository();
    const addPrinter = vi.fn(async () => {
      expect(repository.rows[0]).toMatchObject({
        status: CloudPrinterStatus.BINDING,
        bindingStage: PrinterBindingStage.ADD_PRINTER,
        verifiedAt: historicalVerifiedAt,
      });
      throw Object.assign(new Error('timeout'), {
        name: 'XpyunAdapterError',
        classification: 'UNKNOWN',
      });
    });
    const idempotency = buildIdempotencyRepository();
    const existing = await repository.repo.save({
      serialNumber: SERIAL,
      displayName: '历史设备',
      status: CloudPrinterStatus.UNBOUND,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_UNBOUND,
      bindingIdempotencyKey: 'historical-key',
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: historicalVerifiedAt,
      lastOnlineStatus: CloudPrinterOnlineStatus.OFFLINE,
      lastStatusCheckedAt: new Date('2026-08-01T00:00:00.000Z'),
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: new Date('2026-08-01T00:00:00.000Z'),
      version: 1,
    } as Partial<CloudPrinter>);
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter }),
      repository,
      idempotencyRepository: idempotency.repository,
    });

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'historical-unknown-secret',
        },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );

    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]).toMatchObject({
      id: existing.id,
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      verifiedAt: historicalVerifiedAt,
    });
  });

  it('persists and replays a stable FAILED ownership conflict without becoming owner again', async () => {
    const addPrinter = vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    }));
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-ownership-conflict',
    }));
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const existing = await repository.repo.save({
      serialNumber: SERIAL,
      displayName: '既有设备',
      status: CloudPrinterStatus.ACTIVE,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: 'existing-key',
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      lastOnlineStatus: CloudPrinterOnlineStatus.ONLINE,
      lastStatusCheckedAt: new Date('2026-08-01T00:00:00.000Z'),
      boundByAdminId: '2',
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 7,
    } as Partial<CloudPrinter>);
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, print }),
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const audit = serviceInternals(service).audit.record;
    const key = newIdempotencyKey();
    const request = {
      serialNumber: SERIAL,
      displayName: DISPLAY_NAME,
      operationPassword: 'ownership-secret',
    };

    await expect(
      service.bind({ id: ADMIN_ID } as never, request, key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT),
    );
    await expect(
      service.bind({ id: ADMIN_ID } as never, request, key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT),
    );

    expect(idempotency.repository.insert).toHaveBeenCalledTimes(1);
    expect(addPrinter).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    expect(repository.rows[0]).toMatchObject({
      id: existing.id,
      displayName: '既有设备',
      status: CloudPrinterStatus.ACTIVE,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: 'existing-key',
      verificationCodeHash: null,
      boundByAdminId: '2',
      version: 7,
    });
    expect(idempotency.records).toHaveLength(1);
    expect(idempotency.records[0]).toMatchObject({
      status: 'FAILED',
      resourceType: 'CLOUD_PRINTER',
      resourceId: existing.id,
      responseSnapshot: {
        printerId: existing.id,
        code: 'OWNERSHIP_CONFLICT',
      },
    });
    const serializedRecord = JSON.stringify(idempotency.records[0]);
    expect(serializedRecord).not.toContain(SERIAL);
    expect(serializedRecord).not.toContain('ownership-secret');
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: existing.id,
        action: 'CLOUD_PRINTER_BIND_FAILED',
        changeSummary: expect.objectContaining({ result: 'FAILED' }),
      }),
      expect.anything(),
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain(SERIAL);
    expect(JSON.stringify(audit.mock.calls)).not.toContain('ownership-secret');
    await expectClassificationTransactionsCommitted(service);
  });

  it('lets a different authorized admin rebind local history when queryOnline returns ABNORMAL for the current vendor account', async () => {
    const addPrinter = vi.fn(async () => {
      throw Object.assign(new Error('exists'), {
        name: 'XpyunAdapterError',
        classification: 'FAILED',
        vendorCode: '1011',
      });
    });
    const queryOnline = vi.fn(async () => ({
      status: 'ABNORMAL' as const,
      vendorCode: '0',
    }));
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-ownership-query',
    }));
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const existing = await repository.repo.save({
      serialNumber: SERIAL,
      displayName: '历史设备',
      status: CloudPrinterStatus.UNBOUND,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_UNBOUND,
      bindingIdempotencyKey: 'historical-key',
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: new Date('2026-07-31T00:00:00.000Z'),
      lastOnlineStatus: CloudPrinterOnlineStatus.OFFLINE,
      lastStatusCheckedAt: new Date('2026-08-01T00:00:00.000Z'),
      boundByAdminId: 'historical-admin',
      lastVendorErrorCode: null,
      unboundAt: new Date('2026-08-01T00:00:00.000Z'),
      version: 1,
    } as Partial<CloudPrinter>);
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, queryOnline, print }),
      repository,
      idempotencyRepository: idempotency.repository,
    });

    const result = await service.bind(
      { id: ADMIN_ID } as never,
      {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'pw',
      },
      newIdempotencyKey(),
    );

    expect(result.printer.id).toBe(existing.id);
    expect(addPrinter).toHaveBeenCalledTimes(1);
    expect(queryOnline).toHaveBeenCalledTimes(1);
    expect(queryOnline).toHaveBeenCalledWith(SERIAL);
    expect(print).toHaveBeenCalledTimes(1);
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]).toMatchObject({
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      unboundAt: null,
      verifiedAt: new Date('2026-07-31T00:00:00.000Z'),
      lastVendorErrorCode: null,
      boundByAdminId: ADMIN_ID,
    });
  });

  it.each([
    [
      'SN_USER_NOT_MATCH',
      '1001',
      CloudPrinterStatus.ERROR,
      PrinterBindingStage.RECONCILIATION,
      VendorRelationState.UNKNOWN,
    ],
    [
      'PRINTER_NOT_REGISTER',
      '1002',
      CloudPrinterStatus.UNBOUND,
      PrinterBindingStage.NONE,
      VendorRelationState.CONFIRMED_UNBOUND,
    ],
  ] as const)(
    'persists stable ownership conflict when already-existing query returns %s',
    async (
      _name,
      vendorCode,
      expectedStatus,
      expectedStage,
      expectedRelation,
    ) => {
      const addPrinter = vi.fn(async () => {
        throw Object.assign(new Error('exists'), {
          name: 'XpyunAdapterError',
          classification: 'FAILED',
          vendorCode: '1011',
        });
      });
      const queryOnline = vi.fn(async () => {
        throw Object.assign(new Error('not owned'), {
          name: 'XpyunAdapterError',
          classification: 'FAILED',
          vendorCode,
        });
      });
      const print = vi.fn();
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      await repository.repo.save({
        serialNumber: SERIAL,
        displayName: '历史设备',
        status: CloudPrinterStatus.UNBOUND,
        bindingStage: PrinterBindingStage.NONE,
        vendorRelationState: VendorRelationState.CONFIRMED_UNBOUND,
        bindingIdempotencyKey: 'historical-key',
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationFailedAttempts: 0,
        verifiedAt: new Date('2026-07-31T00:00:00.000Z'),
        lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
        lastStatusCheckedAt: null,
        boundByAdminId: ADMIN_ID,
        lastVendorErrorCode: null,
        unboundAt: new Date('2026-08-01T00:00:00.000Z'),
        version: 1,
      } as Partial<CloudPrinter>);
      const { service } = buildServiceWithManager({
        vendor: buildVendor({ addPrinter, queryOnline, print }),
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const key = newIdempotencyKey();
      const request = {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'ownership-query-secret',
      };

      await expect(
        service.bind({ id: ADMIN_ID } as never, request, key),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT),
      );
      await expect(
        service.bind({ id: ADMIN_ID } as never, request, key),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT),
      );

      expect(addPrinter).toHaveBeenCalledTimes(1);
      expect(queryOnline).toHaveBeenCalledTimes(1);
      expect(print).not.toHaveBeenCalled();
      expect(repository.rows[0]).toMatchObject({
        status: expectedStatus,
        bindingStage: expectedStage,
        vendorRelationState: expectedRelation,
        lastVendorErrorCode: vendorCode,
      });
      expect(idempotency.records[0]).toMatchObject({
        status: 'FAILED',
        responseSnapshot: {
          printerId: repository.rows[0]?.id,
          code: 'OWNERSHIP_CONFLICT',
        },
      });
    },
  );

  it('marks the original operation UNKNOWN when already-existing ownership query is invalid', async () => {
    const addPrinter = vi.fn(async () => {
      throw Object.assign(new Error('exists'), {
        name: 'XpyunAdapterError',
        classification: 'FAILED',
        vendorCode: '1011',
      });
    });
    const queryOnline = vi.fn(async () => ({
      status: 'UNKNOWN' as const,
      vendorCode: '0',
    }));
    const print = vi.fn();
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    await repository.repo.save({
      serialNumber: SERIAL,
      displayName: '历史设备',
      status: CloudPrinterStatus.UNBOUND,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_UNBOUND,
      bindingIdempotencyKey: 'historical-key',
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: new Date('2026-07-31T00:00:00.000Z'),
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: new Date('2026-08-01T00:00:00.000Z'),
      version: 1,
    } as Partial<CloudPrinter>);
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, queryOnline, print }),
      repository,
      idempotencyRepository: idempotency.repository,
    });

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );

    expect(addPrinter).toHaveBeenCalledTimes(1);
    expect(queryOnline).toHaveBeenCalledTimes(1);
    expect(print).not.toHaveBeenCalled();
    expect(repository.rows[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.UNKNOWN,
    });
    expect(idempotency.records[0]).toMatchObject({ status: 'UNKNOWN' });
  });

  it('does not query or take ownership when already-existing has no local history', async () => {
    const addPrinter = vi.fn(async () => {
      throw Object.assign(new Error('exists'), {
        name: 'XpyunAdapterError',
        classification: 'FAILED',
        vendorCode: '1011',
      });
    });
    const queryOnline = vi.fn();
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, queryOnline }),
      repository,
      idempotencyRepository: idempotency.repository,
    });

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT),
    );

    expect(addPrinter).toHaveBeenCalledTimes(1);
    expect(queryOnline).not.toHaveBeenCalled();
    expect(repository.rows[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      vendorRelationState: VendorRelationState.UNKNOWN,
    });
  });

  it.each([
    {
      name: 'add FAILED',
      addClassification: 'FAILED' as const,
      addVendorCode: '1003',
      expectedStatus: CloudPrinterStatus.UNBOUND,
      expectedStage: PrinterBindingStage.NONE,
      expectedRelation: VendorRelationState.CONFIRMED_UNBOUND,
      expectedIdempotency: 'FAILED',
      expectedAuditResult: 'FAILED',
      expectedApiCode: ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED,
    },
    {
      name: 'add UNKNOWN',
      addClassification: 'UNKNOWN' as const,
      addVendorCode: null,
      expectedStatus: CloudPrinterStatus.ERROR,
      expectedStage: PrinterBindingStage.RECONCILIATION,
      expectedRelation: VendorRelationState.UNKNOWN,
      expectedIdempotency: 'UNKNOWN',
      expectedAuditResult: 'UNKNOWN',
      expectedApiCode: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
    },
  ])(
    'atomically persists $name classification before throwing',
    async (testCase) => {
      const addPrinter = vi.fn(async () => {
        throw Object.assign(new Error('vendor add outcome'), {
          name: 'XpyunAdapterError',
          classification: testCase.addClassification,
          vendorCode: testCase.addVendorCode ?? undefined,
        });
      });
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      const { service } = buildServiceWithManager({
        vendor: buildVendor({ addPrinter }),
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const audit = serviceInternals(service).audit.record;

      await expect(
        service.bind(
          { id: ADMIN_ID } as never,
          {
            serialNumber: SERIAL,
            displayName: DISPLAY_NAME,
            operationPassword: 'add-secret',
          },
          newIdempotencyKey(),
        ),
      ).rejects.toMatchObject(expectApiCode(testCase.expectedApiCode));

      expect(repository.rows[0]).toMatchObject({
        status: testCase.expectedStatus,
        bindingStage: testCase.expectedStage,
        vendorRelationState: testCase.expectedRelation,
        verificationCodeHash: null,
        verificationExpiresAt: null,
      });
      expect(idempotency.records[0]).toMatchObject({
        status: testCase.expectedIdempotency,
        resourceId: repository.rows[0]?.id,
      });
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CLOUD_PRINTER_BIND_FAILED',
          changeSummary: expect.objectContaining({
            result: testCase.expectedAuditResult,
            status: testCase.expectedStatus,
          }),
        }),
        expect.anything(),
      );
      expect(JSON.stringify(audit.mock.calls)).not.toContain(SERIAL);
      expect(JSON.stringify(audit.mock.calls)).not.toContain('add-secret');
      await expectClassificationTransactionsCommitted(service);
    },
  );

  it.each([
    {
      name: 'print FAILED and delete ACCEPTED',
      deleteClassification: 'ACCEPTED' as const,
      expectedStatus: CloudPrinterStatus.UNBOUND,
      expectedStage: PrinterBindingStage.NONE,
      expectedRelation: VendorRelationState.CONFIRMED_UNBOUND,
      expectedIdempotency: 'FAILED',
      expectedAuditResult: 'FAILED',
      expectedApiCode: ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED,
    },
    {
      name: 'print FAILED and delete FAILED',
      deleteClassification: 'FAILED' as const,
      expectedStatus: CloudPrinterStatus.ERROR,
      expectedStage: PrinterBindingStage.COMPENSATION_DELETE,
      expectedRelation: VendorRelationState.CONFIRMED_BOUND,
      expectedIdempotency: 'FAILED',
      expectedAuditResult: 'FAILED',
      expectedApiCode: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
    },
    {
      name: 'print FAILED and delete UNKNOWN',
      deleteClassification: 'UNKNOWN' as const,
      expectedStatus: CloudPrinterStatus.ERROR,
      expectedStage: PrinterBindingStage.COMPENSATION_DELETE,
      expectedRelation: VendorRelationState.UNKNOWN,
      expectedIdempotency: 'UNKNOWN',
      expectedAuditResult: 'UNKNOWN',
      expectedApiCode: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
    },
  ])(
    'atomically persists $name classification before throwing',
    async (testCase) => {
      const print = vi.fn(async () => ({
        classification: 'FAILED' as const,
        vendorCode: '2001',
        vendorJobId: null,
      }));
      const deletePrinter = vi.fn(async () => {
        if (testCase.deleteClassification === 'UNKNOWN') {
          throw Object.assign(new Error('delete timeout'), {
            name: 'XpyunAdapterError',
            classification: 'UNKNOWN',
          });
        }
        if (testCase.deleteClassification === 'FAILED') {
          throw Object.assign(new Error('delete rejected'), {
            name: 'XpyunAdapterError',
            classification: 'FAILED',
            vendorCode: '3001',
          });
        }
        return { vendorCode: '0', vendorMessage: 'ok' };
      });
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      const { service } = buildServiceWithManager({
        vendor: buildVendor({ print, deletePrinter }),
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const audit = serviceInternals(service).audit.record;

      await expect(
        service.bind(
          { id: ADMIN_ID } as never,
          {
            serialNumber: SERIAL,
            displayName: DISPLAY_NAME,
            operationPassword: 'print-secret',
          },
          newIdempotencyKey(),
        ),
      ).rejects.toMatchObject(expectApiCode(testCase.expectedApiCode));

      expect(repository.rows[0]).toMatchObject({
        status: testCase.expectedStatus,
        bindingStage: testCase.expectedStage,
        vendorRelationState: testCase.expectedRelation,
        verificationCodeHash: null,
        verificationExpiresAt: null,
      });
      expect(idempotency.records[0]).toMatchObject({
        status: testCase.expectedIdempotency,
        resourceId: repository.rows[0]?.id,
      });
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CLOUD_PRINTER_BIND_FAILED',
          changeSummary: expect.objectContaining({
            result: testCase.expectedAuditResult,
            status: testCase.expectedStatus,
          }),
        }),
        expect.anything(),
      );
      expect(JSON.stringify(audit.mock.calls)).not.toContain(SERIAL);
      expect(JSON.stringify(audit.mock.calls)).not.toContain('print-secret');
      await expectClassificationTransactionsCommitted(service);
    },
  );

  it.each([
    ['RATE_LIMITED', 429, ApiErrorCode.CLOUD_PRINTER_VENDOR_RATE_LIMITED],
    ['UNAVAILABLE', 503, ApiErrorCode.CLOUD_PRINTER_VENDOR_UNAVAILABLE],
  ] as const)(
    'persists initial verification print %s as a stable failure after successful compensation and replays it without vendor I/O',
    async (classification, httpStatus, apiCode) => {
      const addPrinter = vi.fn(async () => ({
        vendorCode: '0',
        vendorMessage: 'ok',
      }));
      const print = vi.fn(async () => {
        throw Object.assign(new Error(`print ${classification}`), {
          name: 'XpyunAdapterError',
          classification,
          vendorCode: 'print-vendor-code',
        });
      });
      const deletePrinter = vi.fn(async () => ({
        vendorCode: '0',
        vendorMessage: 'ok',
      }));
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      const { service } = buildServiceWithManager({
        vendor: buildVendor({ addPrinter, print, deletePrinter }),
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const key = newIdempotencyKey();
      const request = {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'print-classification-secret',
      };

      const first = await service
        .bind({ id: ADMIN_ID } as never, request, key)
        .catch(
          (error: unknown) => error as { response?: unknown; status?: number },
        );
      const second = await service
        .bind({ id: ADMIN_ID } as never, request, key)
        .catch(
          (error: unknown) => error as { response?: unknown; status?: number },
        );

      expect(first).toMatchObject({
        status: httpStatus,
        response: { code: apiCode },
      });
      expect(second).toMatchObject({
        status: httpStatus,
        response: (first as { response: unknown }).response,
      });
      expect(repository.rows[0]).toMatchObject({
        status: CloudPrinterStatus.UNBOUND,
        bindingStage: PrinterBindingStage.NONE,
        vendorRelationState: VendorRelationState.CONFIRMED_UNBOUND,
      });
      expect(idempotency.records[0]).toMatchObject({
        status: 'FAILED',
        responseSnapshot: {
          printerId: repository.rows[0]?.id,
          code:
            classification === 'RATE_LIMITED'
              ? 'VENDOR_RATE_LIMITED'
              : 'VENDOR_UNAVAILABLE',
        },
      });
      expect(addPrinter).toHaveBeenCalledTimes(1);
      expect(print).toHaveBeenCalledTimes(1);
      expect(deletePrinter).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['RATE_LIMITED', 'UNAVAILABLE'] as const)(
    'keeps initial verification print %s UNKNOWN when compensation delete is UNKNOWN and replays without vendor I/O',
    async (classification) => {
      const addPrinter = vi.fn(async () => ({
        vendorCode: '0',
        vendorMessage: 'ok',
      }));
      const print = vi.fn(async () => {
        throw Object.assign(new Error(`print ${classification}`), {
          name: 'XpyunAdapterError',
          classification,
          vendorCode: 'print-vendor-code',
        });
      });
      const deletePrinter = vi.fn(async () => {
        throw Object.assign(new Error('delete timeout'), {
          name: 'XpyunAdapterError',
          classification: 'UNKNOWN',
        });
      });
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      const { service } = buildServiceWithManager({
        vendor: buildVendor({ addPrinter, print, deletePrinter }),
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const key = newIdempotencyKey();
      const request = {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'unknown-compensation-secret',
      };

      await expect(
        service.bind({ id: ADMIN_ID } as never, request, key),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
      );
      await expect(
        service.bind({ id: ADMIN_ID } as never, request, key),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
      );

      expect(repository.rows[0]).toMatchObject({
        status: CloudPrinterStatus.ERROR,
        bindingStage: PrinterBindingStage.COMPENSATION_DELETE,
        vendorRelationState: VendorRelationState.UNKNOWN,
      });
      expect(idempotency.records[0]).toMatchObject({ status: 'UNKNOWN' });
      expect(addPrinter).toHaveBeenCalledTimes(1);
      expect(print).toHaveBeenCalledTimes(1);
      expect(deletePrinter).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps UNKNOWN fenced and rejects a new key after transient vendor failure', async () => {
    let attempt = 0;
    const addPrinter = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error('timeout'), {
          name: 'XpyunAdapterError',
          classification: 'UNKNOWN',
        });
      }
      return { vendorCode: '0', vendorMessage: 'ok' };
    });
    const deletePrinter = vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    }));
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-1',
    }));
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, deletePrinter, print }),
      repository,
      idempotencyRepository,
    });

    const originalKey = newIdempotencyKey();
    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        originalKey,
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT),
    );
    expect(addPrinter).toHaveBeenCalledTimes(1);
  });

  it('marks print-code UNKNOWN for reconciliation without deleting the confirmed vendor relation', async () => {
    const addPrinter = vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    }));
    const print = vi.fn(async () => {
      throw Object.assign(new Error('timeout'), {
        name: 'XpyunAdapterError',
        classification: 'UNKNOWN',
      });
    });
    const deletePrinter = vi.fn();
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, print, deletePrinter }),
      repository,
      idempotencyRepository: idempotency.repository,
    });

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );

    expect(deletePrinter).not.toHaveBeenCalled();
    expect(repository.rows[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      unboundAt: null,
    });
    expect(idempotency.records[0]).toMatchObject({
      status: 'UNKNOWN',
      resourceId: repository.rows[0]?.id,
    });
  });

  it('falls back to ERROR/reconciliation and UNKNOWN when saveChallenge locally fails after vendor add succeeds', async () => {
    const addPrinter = vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    }));
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-1',
    }));
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const originalSave = repository.repo.save.getMockImplementation();
    let saveChallengeInterrupted = false;
    repository.repo.save.mockImplementation(
      async (value: Partial<CloudPrinter>) => {
        const stage = (value as { bindingStage?: PrinterBindingStage })
          .bindingStage;
        if (
          stage === PrinterBindingStage.PRINT_VERIFICATION_CODE &&
          !saveChallengeInterrupted
        ) {
          saveChallengeInterrupted = true;
          throw new Error('saveChallenge local interruption');
        }
        return (originalSave ?? (async () => ({}) as CloudPrinter))(value);
      },
    );
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, print }),
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const audit = serviceInternals(service).audit.record;

    await expect(
      service.bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );

    expect(saveChallengeInterrupted).toBe(true);
    expect(addPrinter).toHaveBeenCalledTimes(1);
    expect(print).not.toHaveBeenCalled();
    expect(repository.rows[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    });
    expect(idempotency.records[0]).toMatchObject({
      status: 'UNKNOWN',
      resourceType: 'CLOUD_PRINTER',
      resourceId: repository.rows[0]?.id,
    });
    expect(idempotency.records[0]?.status).not.toBe('IN_PROGRESS');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLOUD_PRINTER_BIND_FAILED',
        changeSummary: expect.objectContaining({ result: 'UNKNOWN' }),
      }),
      expect.anything(),
    );
  });

  it('returns a safe processing error and leaves durable IN_PROGRESS when final commit fallback also fails', async () => {
    const addPrinter = vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    }));
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-final-commit-failure',
    }));
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const originalSave = repository.repo.save.getMockImplementation();
    repository.repo.save.mockImplementation(
      async (value: Partial<CloudPrinter>) => {
        if (
          value.status === CloudPrinterStatus.PENDING_VERIFICATION ||
          (value.status === CloudPrinterStatus.ERROR &&
            value.bindingStage === PrinterBindingStage.RECONCILIATION)
        ) {
          throw new Error('SQL password=final-commit-secret');
        }
        return (originalSave ?? (async () => ({}) as CloudPrinter))(value);
      },
    );
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, print }),
      repository,
      idempotencyRepository: idempotency.repository,
    });

    const error = await service
      .bind(
        { id: ADMIN_ID } as never,
        {
          serialNumber: SERIAL,
          displayName: DISPLAY_NAME,
          operationPassword: 'pw',
        },
        newIdempotencyKey(),
      )
      .catch((cause: unknown) => cause as { response?: unknown });

    expect(error).toMatchObject({
      response: {
        code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
        message: '打印机操作正在处理中，请稍后重试',
      },
    });
    expect(JSON.stringify(error)).not.toMatch(
      /SQL|final-commit-secret|password=/u,
    );
    expect(addPrinter).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
    expect(idempotency.records[0]).toMatchObject({ status: 'IN_PROGRESS' });
    expect(idempotency.records[0]?.status).not.toBe('FAILED');
    expect(idempotency.records[0]?.status).not.toBe('COMPLETED');
  });

  it.each([
    {
      name: 'ONLINE',
      outcome: { status: 'ONLINE' as const, vendorCode: '0' },
      expectedRelation: VendorRelationState.CONFIRMED_BOUND,
      terminal: true,
    },
    {
      name: 'OFFLINE',
      outcome: { status: 'OFFLINE' as const, vendorCode: '0' },
      expectedRelation: VendorRelationState.CONFIRMED_BOUND,
      terminal: true,
    },
    {
      name: 'ABNORMAL',
      outcome: { status: 'ABNORMAL' as const, vendorCode: '0' },
      expectedRelation: VendorRelationState.CONFIRMED_BOUND,
      terminal: true,
    },
    {
      name: 'UNKNOWN result status',
      outcome: { status: 'UNKNOWN' as const, vendorCode: '0' },
      expectedRelation: VendorRelationState.UNKNOWN,
      terminal: false,
    },
    {
      name: 'SN_USER_NOT_MATCH',
      errorClassification: 'FAILED' as const,
      vendorCode: '1001',
      expectedRelation: VendorRelationState.UNKNOWN,
      terminal: false,
    },
    {
      name: 'PRINTER_NOT_REGISTER',
      errorClassification: 'FAILED' as const,
      vendorCode: '1002',
      expectedRelation: VendorRelationState.CONFIRMED_UNBOUND,
      terminal: true,
    },
    {
      name: 'rate limit',
      errorClassification: 'FAILED' as const,
      vendorCode: '1033',
      expectedRelation: VendorRelationState.UNKNOWN,
      terminal: false,
    },
    {
      name: 'account restriction',
      errorClassification: 'FAILED' as const,
      vendorCode: '1022',
      expectedRelation: VendorRelationState.UNKNOWN,
      terminal: false,
    },
    {
      name: 'service unavailable',
      errorClassification: 'UNKNOWN' as const,
      vendorCode: null,
      expectedRelation: VendorRelationState.UNKNOWN,
      terminal: false,
    },
    {
      name: 'invalid schema',
      errorClassification: 'UNKNOWN' as const,
      vendorCode: null,
      expectedRelation: VendorRelationState.UNKNOWN,
      terminal: false,
    },
    {
      name: 'other FAILED',
      errorClassification: 'FAILED' as const,
      vendorCode: '1003',
      expectedRelation: VendorRelationState.UNKNOWN,
      terminal: false,
    },
  ] as const)(
    'uses only operation-specific queryOnline evidence for stale recovery: $name',
    async (testCase) => {
      const now = new Date('2026-08-04T00:02:00.000Z');
      const repository = buildPrinterRepository();
      repository.rows.push({
        id: 'stale-printer',
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        status: CloudPrinterStatus.ERROR,
        bindingStage: PrinterBindingStage.RECONCILIATION,
        vendorRelationState: VendorRelationState.UNKNOWN,
        bindingIdempotencyKey: 'historical-key',
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationFailedAttempts: 0,
        verifiedAt: null,
        lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
        lastStatusCheckedAt: null,
        boundByAdminId: 'historical-admin',
        lastVendorErrorCode: null,
        unboundAt: null,
        version: 1,
      } as CloudPrinter);
      const idempotency = buildIdempotencyRepository();
      const queryOnline = vi.fn(async () => {
        if ('outcome' in testCase) return testCase.outcome;
        throw Object.assign(new Error(`query ${testCase.name}`), {
          name: 'XpyunAdapterError',
          classification: testCase.errorClassification,
          vendorCode: testCase.vendorCode ?? undefined,
        });
      });
      const vendor = buildVendor({ queryOnline });
      const { service } = buildServiceWithManager({
        vendor,
        repository,
        idempotencyRepository: idempotency.repository,
        now: () => now,
      });
      const key = newIdempotencyKey();
      const request = {
        serialNumber: SERIAL,
        displayName: DISPLAY_NAME,
        operationPassword: 'stale-secret',
      };
      const idempotencyService = (
        service as unknown as {
          idempotencyService: AdminOperationIdempotencyService;
        }
      ).idempotencyService;
      idempotency.records.push({
        id: 'stale-operation',
        adminId: ADMIN_ID,
        operation: 'CLOUD_PRINTER_BIND',
        key,
        requestHash: idempotencyService.hashRequest(request),
        status: 'IN_PROGRESS',
        resourceType: null,
        resourceId: null,
        responseSnapshot: null,
        updatedAt: new Date(now.getTime() - 120_000),
      });

      const error = await service
        .bind({ id: ADMIN_ID } as never, request, key)
        .then(
          () => null,
          (cause: unknown) => cause as { response?: { code?: string } },
        );

      expect(error?.response?.code).toBe(
        testCase.terminal
          ? ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED
          : ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
      );
      expect(vendor.addPrinter).not.toHaveBeenCalled();
      expect(vendor.print).not.toHaveBeenCalled();
      expect(queryOnline).toHaveBeenCalledTimes(1);
      expect(repository.rows[0]?.vendorRelationState).toBe(
        testCase.expectedRelation,
      );
      expect(idempotency.records[0]?.status).toBe(
        testCase.terminal ? 'FAILED' : 'UNKNOWN',
      );
      if (!testCase.terminal) {
        expect(repository.repo.save).not.toHaveBeenCalled();
        expect(idempotency.records[0]?.responseSnapshot).toBeNull();
      }
    },
  );

  it('returns a safe processing error and leaves durable IN_PROGRESS when saveChallenge fallback also fails', async () => {
    const addPrinter = vi.fn(async () => ({
      vendorCode: '0',
      vendorMessage: 'ok',
    }));
    const print = vi.fn();
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const originalSave = repository.repo.save.getMockImplementation();
    repository.repo.save.mockImplementation(
      async (value: Partial<CloudPrinter>) => {
        const stage = (value as { bindingStage?: PrinterBindingStage })
          .bindingStage;
        if (
          stage === PrinterBindingStage.PRINT_VERIFICATION_CODE ||
          stage === PrinterBindingStage.RECONCILIATION
        ) {
          throw new Error('SQL password=database-secret');
        }
        return (originalSave ?? (async () => ({}) as CloudPrinter))(value);
      },
    );
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ addPrinter, print }),
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const key = newIdempotencyKey();
    const request = {
      serialNumber: SERIAL,
      displayName: DISPLAY_NAME,
      operationPassword: 'pw',
    };

    const firstError = await service
      .bind({ id: ADMIN_ID } as never, request, key)
      .catch(
        (error: unknown) => error as { response?: unknown; message: string },
      );
    expect(firstError).toMatchObject({
      response: {
        code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
        message: '打印机操作正在处理中，请稍后重试',
      },
    });
    expect(JSON.stringify(firstError)).not.toMatch(
      /SQL|database-secret|password=/u,
    );
    await expect(
      service.bind({ id: ADMIN_ID } as never, request, key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_IN_PROGRESS),
    );

    expect(addPrinter).toHaveBeenCalledTimes(1);
    expect(print).not.toHaveBeenCalled();
    expect(idempotency.records[0]).toMatchObject({ status: 'IN_PROGRESS' });
    expect(idempotency.records[0]?.status).not.toBe('FAILED');
    expect(idempotency.records[0]?.status).not.toBe('COMPLETED');
  });
});

describe('CloudPrinterService.confirm', () => {
  const SERIAL = 'SN-ConfirmTest-1';

  it('rejects when challenge id is unknown', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository,
    });

    await expect(
      service.confirm(
        { id: ADMIN_ID } as never,
        {
          challengeId: 'absent-challenge',
          code: '1234',
          operationPassword: 'pw',
        },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expect.objectContaining({
        response: expect.objectContaining({ code: expect.any(String) }),
      }),
    );
  });

  it('transitions to ACTIVE on matching code and clears the challenge', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const initialPrinter: Partial<CloudPrinter> = {
      id: 'printer-1',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      verificationCodeHash: await hashChallengeFixture('123456'),
      verificationExpiresAt: new Date(Date.now() + 60_000),
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    };
    repository.rows.push(initialPrinter as CloudPrinter);

    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository,
    });

    const result: ConfirmCloudPrinterResult = await service.confirm(
      { id: ADMIN_ID } as never,
      { challengeId: 'printer-1', code: '123456', operationPassword: 'pw' },
      newIdempotencyKey(),
    );

    expect(result.printer.status).toBe(CloudPrinterStatus.ACTIVE);
    const stored = repository.rows[0]!;
    expect(stored.verificationCodeHash).toBeNull();
    expect(stored.verifiedAt).toBeInstanceOf(Date);
  });

  it('confirm 将完整 SN、操作密码与验证码传入 snapshot 校验路径', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    repository.rows.push({
      id: 'printer-confirm-sensitive',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      verificationCodeHash: await hashChallengeFixture('654321'),
      verificationExpiresAt: new Date(Date.now() + 60_000),
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    } as CloudPrinter);
    const service = buildService({ repository, idempotencyRepository });
    const idempotency = (
      service as unknown as {
        idempotencyService: AdminOperationIdempotencyService;
      }
    ).idempotencyService;
    const complete = vi.spyOn(idempotency, 'complete');

    await service.confirm(
      { id: ADMIN_ID } as never,
      {
        challengeId: 'printer-confirm-sensitive',
        code: '654321',
        operationPassword: 'confirm-secret',
      },
      newIdempotencyKey(),
    );

    expect(complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sensitiveValues: [SERIAL, 'confirm-secret', '654321'],
      }),
    );
  });

  it('confirms existing dirty displayName as ACTIVE while returning a safe masked fallback', async () => {
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    repository.rows.push({
      id: 'printer-confirm-leak',
      serialNumber: SERIAL,
      displayName: `门店-${SERIAL.toLowerCase()}-前台`,
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      verificationCodeHash: await hashChallengeFixture('654321'),
      verificationExpiresAt: new Date(Date.now() + 60_000),
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    } as CloudPrinter);
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
    });

    const result = await service.confirm(
      { id: ADMIN_ID } as never,
      {
        challengeId: 'printer-confirm-leak',
        code: '654321',
        operationPassword: 'confirm-secret',
      },
      newIdempotencyKey(),
    );

    expect(result.printer.status).toBe(CloudPrinterStatus.ACTIVE);
    expect(result.printer.displayName).toBe(
      `打印机 ${result.printer.serialNumberMasked}`,
    );
    expect(JSON.stringify(result)).not.toContain(SERIAL);
    expect(repository.rows[0]?.displayName).toBe(
      `门店-${SERIAL.toLowerCase()}-前台`,
    );
    expect(idempotency.records[0]).toMatchObject({ status: 'COMPLETED' });
  });

  it.each([
    ['操作密码', 'confirm-secret'],
    ['验证码', '654321'],
  ])(
    'confirm 拒绝 displayName 中的%s且不持久化 response snapshot',
    async (_, displayName) => {
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      repository.rows.push({
        id: 'printer-confirm-leak',
        serialNumber: SERIAL,
        displayName,
        status: CloudPrinterStatus.PENDING_VERIFICATION,
        bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
        bindingIdempotencyKey: null,
        verificationCodeHash: await hashChallengeFixture('654321'),
        verificationExpiresAt: new Date(Date.now() + 60_000),
        verificationFailedAttempts: 0,
        verifiedAt: null,
        lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
        lastStatusCheckedAt: null,
        boundByAdminId: ADMIN_ID,
        lastVendorErrorCode: null,
        unboundAt: null,
        version: 1,
      } as CloudPrinter);
      const service = buildService({
        repository,
        idempotencyRepository: idempotency.repository,
      });

      await expect(
        service.confirm(
          { id: ADMIN_ID } as never,
          {
            challengeId: 'printer-confirm-leak',
            code: '654321',
            operationPassword: 'confirm-secret',
          },
          newIdempotencyKey(),
        ),
      ).rejects.toThrow('response snapshot contains sensitive value');

      expect(idempotency.records[0]).toMatchObject({
        status: 'IN_PROGRESS',
        responseSnapshot: null,
      });
      expect(JSON.stringify(idempotency.records[0])).not.toContain(displayName);
    },
  );

  it('exhausts immediately on the fifth invalid code and replays the stable failure without rechecking bcrypt or advancing state', async () => {
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const initialPrinter: Partial<CloudPrinter> = {
      id: 'printer-2',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      verificationCodeHash: await hashChallengeFixture('999999'),
      verificationExpiresAt: new Date(Date.now() + 60_000),
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    };
    repository.rows.push(initialPrinter as CloudPrinter);

    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const compare = vi.spyOn(bcrypt, 'compare');
    const request = {
      challengeId: 'printer-2',
      code: '111111',
      operationPassword: 'pw',
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        service.confirm(
          { id: ADMIN_ID } as never,
          request,
          newIdempotencyKey(),
        ),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID),
      );
    }

    const fifthKey = newIdempotencyKey();
    await expect(
      service.confirm({ id: ADMIN_ID } as never, request, fifthKey),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED),
    );

    expect(repository.rows[0]).toMatchObject({
      verificationFailedAttempts: 5,
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
    });
    expect(idempotency.records[4]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: {
        printerId: 'printer-2',
        code: 'ATTEMPTS_EXHAUSTED',
      },
    });
    const stateAfterFifth = { ...repository.rows[0] };
    const compareCallsAfterFifth = compare.mock.calls.length;
    const saveCallsAfterFifth = repository.repo.save.mock.calls.length;

    await expect(
      service.confirm({ id: ADMIN_ID } as never, request, fifthKey),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED),
    );

    expect(compare).toHaveBeenCalledTimes(compareCallsAfterFifth);
    expect(repository.repo.save).toHaveBeenCalledTimes(saveCallsAfterFifth);
    expect(repository.rows[0]).toEqual(stateAfterFifth);
    expect(idempotency.records).toHaveLength(5);
    compare.mockRestore();
  });

  it('marks the owning operation UNKNOWN when bcrypt throws and replays without comparing again', async () => {
    const repository = buildPrinterRepository([
      await confirmPrinterFixture('confirm-bcrypt-error', SERIAL),
    ]);
    const idempotency = buildIdempotencyRepository();
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const compare = vi
      .spyOn(bcrypt, 'compare')
      .mockRejectedValueOnce(new Error('bcrypt worker interrupted'));
    const key = newIdempotencyKey();
    const request = {
      challengeId: 'confirm-bcrypt-error',
      code: '654321',
      operationPassword: 'confirm-secret',
    };

    await expect(
      service.confirm({ id: ADMIN_ID } as never, request, key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );
    await expect(
      service.confirm({ id: ADMIN_ID } as never, request, key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );

    expect(compare).toHaveBeenCalledTimes(1);
    expect(idempotency.records).toHaveLength(1);
    expect(idempotency.records[0]).toMatchObject({
      status: 'UNKNOWN',
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'confirm-bcrypt-error',
    });
    expect(JSON.stringify(idempotency.records[0])).not.toContain(
      repository.rows[0]?.verificationCodeHash,
    );
    compare.mockRestore();
  });

  it.each(['save', 'audit'] as const)(
    'marks the owning operation UNKNOWN when the terminal %s step fails and replays stably',
    async (failedStep) => {
      const repository = buildPrinterRepository([
        await confirmPrinterFixture(`confirm-${failedStep}-error`, SERIAL),
      ]);
      const idempotency = buildIdempotencyRepository();
      const service = buildService({
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const transaction = serviceInternals(service).dataSource.transaction;
      const runTransaction = transaction.getMockImplementation()!;
      transaction.mockImplementation(async (operation) => {
        const printerSnapshot = structuredClone(repository.rows);
        const operationSnapshot = structuredClone(idempotency.records);
        try {
          return await runTransaction(operation);
        } catch (error) {
          repository.rows.splice(0, repository.rows.length, ...printerSnapshot);
          idempotency.records.splice(
            0,
            idempotency.records.length,
            ...operationSnapshot,
          );
          throw error;
        }
      });
      if (failedStep === 'save') {
        repository.repo.save.mockRejectedValueOnce(
          new Error('confirm save interrupted'),
        );
      } else {
        serviceInternals(service).audit.record.mockRejectedValueOnce(
          new Error('confirm audit interrupted'),
        );
      }
      const compare = vi.spyOn(bcrypt, 'compare');
      const key = newIdempotencyKey();
      const request = {
        challengeId: `confirm-${failedStep}-error`,
        code: '654321',
        operationPassword: 'confirm-secret',
      };

      await expect(
        service.confirm({ id: ADMIN_ID } as never, request, key),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
      );
      const stateAfterFailure = structuredClone(repository.rows[0]);
      await expect(
        service.confirm({ id: ADMIN_ID } as never, request, key),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
      );

      expect(compare).toHaveBeenCalledTimes(1);
      expect(repository.rows[0]).toEqual(stateAfterFailure);
      expect(idempotency.records).toHaveLength(1);
      expect(idempotency.records[0]).toMatchObject({
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: `confirm-${failedStep}-error`,
      });
      expect(idempotency.records[0]?.responseSnapshot).not.toMatchObject({
        printer: expect.anything(),
        code: expect.anything(),
      });
      compare.mockRestore();
    },
  );

  it('returns safe persistence unavailable when UNKNOWN fallback also fails without forging a terminal result', async () => {
    const repository = buildPrinterRepository([
      await confirmPrinterFixture('confirm-fallback-error', SERIAL),
    ]);
    const idempotency = buildIdempotencyRepository();
    const originalUpdate =
      idempotency.repository.update.getMockImplementation()!;
    idempotency.repository.update.mockImplementation(async (where, values) => {
      if ((values as { status?: string }).status === 'UNKNOWN') {
        throw new Error('SQL password=confirm-fallback-secret');
      }
      return originalUpdate(where, values);
    });
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const compare = vi
      .spyOn(bcrypt, 'compare')
      .mockRejectedValueOnce(new Error('bcrypt worker interrupted'));
    const key = newIdempotencyKey();
    const request = {
      challengeId: 'confirm-fallback-error',
      code: '654321',
      operationPassword: 'confirm-secret',
    };

    const error = await service
      .confirm({ id: ADMIN_ID } as never, request, key)
      .catch((cause: unknown) => cause as { response?: unknown });

    expect(error).toMatchObject({
      response: {
        code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
        message: '打印机操作正在处理中，请稍后重试',
      },
    });
    expect(JSON.stringify(error)).not.toMatch(/SQL|password=|fallback-secret/u);
    expect(idempotency.records[0]).toMatchObject({ status: 'IN_PROGRESS' });
    expect(idempotency.records[0]?.status).not.toBe('FAILED');
    expect(idempotency.records[0]?.status).not.toBe('COMPLETED');
    await expect(
      service.confirm({ id: ADMIN_ID } as never, request, key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_IN_PROGRESS),
    );
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();
  });

  it('fences a confirm IN_PROGRESS stale at 120 seconds to UNKNOWN without bcrypt', async () => {
    const now = new Date('2026-08-04T00:02:00.000Z');
    const request = {
      challengeId: 'confirm-stale',
      code: '654321',
      operationPassword: 'confirm-secret',
    };
    const repository = buildPrinterRepository([
      await confirmPrinterFixture(request.challengeId, SERIAL),
    ]);
    const idempotency = buildIdempotencyRepository();
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
      now: () => now,
    });
    const idempotencyService = (
      service as unknown as {
        idempotencyService: AdminOperationIdempotencyService;
      }
    ).idempotencyService;
    const key = newIdempotencyKey();
    idempotency.records.push({
      id: 'confirm-stale-operation',
      adminId: ADMIN_ID,
      operation: 'CLOUD_PRINTER_CONFIRM',
      key,
      requestHash: idempotencyService.hashRequest(request),
      status: 'IN_PROGRESS',
      resourceType: 'CLOUD_PRINTER',
      resourceId: request.challengeId,
      responseSnapshot: null,
      updatedAt: new Date(now.getTime() - 120_000),
    });
    const compare = vi.spyOn(bcrypt, 'compare');

    await expect(
      service.confirm({ id: ADMIN_ID } as never, request, key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );

    expect(compare).not.toHaveBeenCalled();
    expect(
      serviceInternals(service).verification.verifyPassword,
    ).not.toHaveBeenCalled();
    expect(idempotency.records[0]).toMatchObject({ status: 'UNKNOWN' });
    compare.mockRestore();
  });

  it('keeps a fresh confirm IN_PROGRESS processing without bcrypt', async () => {
    const now = new Date('2026-08-04T00:02:00.000Z');
    const request = {
      challengeId: 'confirm-fresh',
      code: '654321',
      operationPassword: 'confirm-secret',
    };
    const repository = buildPrinterRepository([
      await confirmPrinterFixture(request.challengeId, SERIAL),
    ]);
    const idempotency = buildIdempotencyRepository();
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
      now: () => now,
    });
    const idempotencyService = (
      service as unknown as {
        idempotencyService: AdminOperationIdempotencyService;
      }
    ).idempotencyService;
    const key = newIdempotencyKey();
    idempotency.records.push({
      id: 'confirm-fresh-operation',
      adminId: ADMIN_ID,
      operation: 'CLOUD_PRINTER_CONFIRM',
      key,
      requestHash: idempotencyService.hashRequest(request),
      status: 'IN_PROGRESS',
      resourceType: 'CLOUD_PRINTER',
      resourceId: request.challengeId,
      responseSnapshot: null,
      updatedAt: new Date(now.getTime() - 119_999),
    });
    const compare = vi.spyOn(bcrypt, 'compare');

    await expect(
      service.confirm({ id: ADMIN_ID } as never, request, key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_IN_PROGRESS),
    );

    expect(compare).not.toHaveBeenCalled();
    expect(
      serviceInternals(service).verification.verifyPassword,
    ).not.toHaveBeenCalled();
    expect(idempotency.records[0]).toMatchObject({ status: 'IN_PROGRESS' });
    compare.mockRestore();
  });

  it('rejects expired challenges without incrementing attempts', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const initialPrinter: Partial<CloudPrinter> = {
      id: 'printer-3',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      verificationCodeHash: await hashChallengeFixture('222222'),
      verificationExpiresAt: new Date(Date.now() - 1000),
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    };
    repository.rows.push(initialPrinter as CloudPrinter);

    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository,
      now: () => new Date(),
    });

    await expect(
      service.confirm(
        { id: ADMIN_ID } as never,
        { challengeId: 'printer-3', code: '222222', operationPassword: 'pw' },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expect.objectContaining({
        response: expect.objectContaining({
          code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_EXPIRED,
        }),
      }),
    );
    expect(repository.rows[0]?.verificationFailedAttempts).toBe(0);
  });
});

describe('CloudPrinterService.resend', () => {
  const SERIAL = 'SN-Resend-1';

  it.each([
    ['RATE_LIMITED', 429, ApiErrorCode.CLOUD_PRINTER_VENDOR_RATE_LIMITED],
    ['UNAVAILABLE', 503, ApiErrorCode.CLOUD_PRINTER_VENDOR_UNAVAILABLE],
  ] as const)(
    'persists resend print %s as a stable failure and replays it without printing again',
    async (classification, httpStatus, apiCode) => {
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      repository.rows.push({
        id: 'resend-classified-failure',
        serialNumber: SERIAL,
        displayName: '前台',
        status: CloudPrinterStatus.PENDING_VERIFICATION,
        bindingStage: PrinterBindingStage.NONE,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
        bindingIdempotencyKey: null,
        verificationCodeHash: await hashChallengeFixture('111111'),
        verificationExpiresAt: new Date(Date.now() + 60_000),
        verificationFailedAttempts: 2,
        verifiedAt: null,
        lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
        lastStatusCheckedAt: null,
        boundByAdminId: ADMIN_ID,
        lastVendorErrorCode: null,
        unboundAt: null,
        version: 1,
      } as CloudPrinter);
      const print = vi.fn(async () => {
        throw Object.assign(new Error(`resend ${classification}`), {
          name: 'XpyunAdapterError',
          classification,
          vendorCode: 'resend-vendor-code',
        });
      });
      const { service } = buildServiceWithManager({
        vendor: buildVendor({ print }),
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const key = newIdempotencyKey();
      const request = { operationPassword: 'resend-classification-secret' };

      const first = await service
        .resend(
          { id: ADMIN_ID } as never,
          'resend-classified-failure',
          request,
          key,
        )
        .catch(
          (error: unknown) => error as { response?: unknown; status?: number },
        );
      const second = await service
        .resend(
          { id: ADMIN_ID } as never,
          'resend-classified-failure',
          request,
          key,
        )
        .catch(
          (error: unknown) => error as { response?: unknown; status?: number },
        );

      expect(first).toMatchObject({
        status: httpStatus,
        response: { code: apiCode },
      });
      expect(second).toMatchObject({
        status: httpStatus,
        response: (first as { response: unknown }).response,
      });
      expect(idempotency.records[0]).toMatchObject({
        status: 'FAILED',
        responseSnapshot: {
          printerId: 'resend-classified-failure',
          code:
            classification === 'RATE_LIMITED'
              ? 'VENDOR_RATE_LIMITED'
              : 'VENDOR_UNAVAILABLE',
        },
      });
      expect(print).toHaveBeenCalledTimes(1);
    },
  );

  it('clears the newly staged challenge when resend print is explicitly FAILED', async () => {
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    repository.rows.push({
      id: 'resend-failed-challenge',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      verificationCodeHash: await hashChallengeFixture('111111'),
      verificationExpiresAt: new Date(Date.now() + 60_000),
      verificationFailedAttempts: 2,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    } as CloudPrinter);
    const print = vi.fn(async () => ({
      classification: 'FAILED' as const,
      vendorCode: '2001',
      vendorJobId: null,
    }));
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ print }),
      repository,
      idempotencyRepository: idempotency.repository,
    });

    await expect(
      service.resend(
        { id: ADMIN_ID } as never,
        'resend-failed-challenge',
        { operationPassword: 'pw' },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED),
    );

    expect(repository.rows[0]).toMatchObject({
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
    });
  });

  it('reuses the same serial record and refreshes the challenge', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const initialPrinter: Partial<CloudPrinter> = {
      id: 'printer-9',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      verificationCodeHash: await hashChallengeFixture('111111'),
      verificationExpiresAt: new Date(Date.now() + 60_000),
      verificationFailedAttempts: 1,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    };
    repository.rows.push(initialPrinter as CloudPrinter);

    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-2',
    }));
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ print }),
      repository,
      idempotencyRepository,
    });

    const result: ResendCloudPrinterVerificationResult = await service.resend(
      { id: ADMIN_ID } as never,
      'printer-9',
      { operationPassword: 'pw' },
      newIdempotencyKey(),
    );

    expect(print).toHaveBeenCalledTimes(1);
    expect(firstPrintInput(print).tradeOrderId).toMatch(
      /^cp-.+-[a-f0-9]{32}$/u,
    );
    expect(firstPrintInput(print).tradeOrderId.length).toBeLessThanOrEqual(50);
    expect(result.challenge.remainingAttempts).toBe(5);
    expect(repository.rows).toHaveLength(1);
    const stored = repository.rows[0]!;
    expect(stored.verificationFailedAttempts).toBe(0);
    expect(stored.verificationCodeHash).not.toBe('plaintext:111111');
    expect(stored.bindingIdempotencyKey).toBe(
      idempotencyRepository.insert.mock.calls[0]?.[0].key,
    );
  });

  it.each([
    [CloudPrinterStatus.ACTIVE, PrinterBindingStage.NONE],
    [CloudPrinterStatus.UNBOUND, PrinterBindingStage.NONE],
    [CloudPrinterStatus.UNBINDING, PrinterBindingStage.UNBIND_DELETE],
    [CloudPrinterStatus.BINDING, PrinterBindingStage.ADD_PRINTER],
    [CloudPrinterStatus.ERROR, PrinterBindingStage.COMPENSATION_DELETE],
    [CloudPrinterStatus.ERROR, PrinterBindingStage.UNBIND_DELETE],
  ] as const)(
    'stably rejects resend for status %s at stage %s without vendor I/O',
    async (status, bindingStage) => {
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      repository.rows.push({
        id: 'resend-gate-printer',
        serialNumber: SERIAL,
        displayName: '前台',
        status,
        bindingStage,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
        bindingIdempotencyKey: 'prior-key',
        verificationCodeHash: await hashChallengeFixture('111111'),
        verificationExpiresAt: new Date(Date.now() + 60_000),
        verificationFailedAttempts: 0,
        verifiedAt: null,
        lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
        lastStatusCheckedAt: null,
        boundByAdminId: ADMIN_ID,
        lastVendorErrorCode: null,
        unboundAt: null,
        version: 1,
      } as CloudPrinter);
      const vendor = buildVendor({});
      const { service } = buildServiceWithManager({
        vendor,
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const key = newIdempotencyKey();
      const request = { operationPassword: 'pw' };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(
          service.resend(
            { id: ADMIN_ID } as never,
            'resend-gate-printer',
            request,
            key,
          ),
        ).rejects.toMatchObject(
          expectApiCode(ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED),
        );
      }

      expect(idempotency.records).toHaveLength(1);
      expect(idempotency.records[0]).toMatchObject({ status: 'FAILED' });
      expect(vendor.print).not.toHaveBeenCalled();
      expect(vendor.queryOnline).not.toHaveBeenCalled();
      expect(repository.repo.save).not.toHaveBeenCalled();
    },
  );

  it.each([
    [CloudPrinterStatus.PENDING_VERIFICATION, PrinterBindingStage.NONE],
    [CloudPrinterStatus.BINDING, PrinterBindingStage.PRINT_VERIFICATION_CODE],
    [CloudPrinterStatus.BINDING, PrinterBindingStage.RECONCILIATION],
    [CloudPrinterStatus.ERROR, PrinterBindingStage.PRINT_VERIFICATION_CODE],
    [CloudPrinterStatus.ERROR, PrinterBindingStage.RECONCILIATION],
  ] as const)(
    'allows resend for paper-verification status %s at stage %s',
    async (status, bindingStage) => {
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      repository.rows.push({
        id: 'resend-allowed-printer',
        serialNumber: SERIAL,
        displayName: '前台',
        status,
        bindingStage,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
        bindingIdempotencyKey: 'prior-key',
        verificationCodeHash: await hashChallengeFixture('111111'),
        verificationExpiresAt: new Date(Date.now() + 60_000),
        verificationFailedAttempts: 0,
        verifiedAt: null,
        lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
        lastStatusCheckedAt: null,
        boundByAdminId: ADMIN_ID,
        lastVendorErrorCode: null,
        unboundAt: null,
        version: 1,
      } as CloudPrinter);
      const vendor = buildVendor({});
      const { service } = buildServiceWithManager({
        vendor,
        repository,
        idempotencyRepository: idempotency.repository,
      });
      const key = newIdempotencyKey();

      await expect(
        service.resend(
          { id: ADMIN_ID } as never,
          'resend-allowed-printer',
          { operationPassword: 'pw' },
          key,
        ),
      ).resolves.toMatchObject({ printer: { id: 'resend-allowed-printer' } });
      expect(repository.rows[0]?.bindingIdempotencyKey).toBe(key);
      expect(repository.rows[0]?.bindingOperationId).toBe(
        idempotency.records[0]?.id,
      );
      expect(vendor.print).toHaveBeenCalledTimes(1);
    },
  );

  it('stably rejects a new resend while the current binding key is UNKNOWN and creates no challenge or vendor call', async () => {
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const currentKey = newIdempotencyKey();
    repository.rows.push({
      id: 'resend-unknown-printer',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: currentKey,
      bindingOperationId: 'old-unknown',
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    } as CloudPrinter);
    idempotency.records.push({
      id: 'old-unknown',
      adminId: ADMIN_ID,
      operation: 'CLOUD_PRINTER_BIND',
      key: currentKey,
      requestHash: 'a'.repeat(64),
      status: 'UNKNOWN',
      resourceType: 'CLOUD_PRINTER',
      resourceId: 'resend-unknown-printer',
      responseSnapshot: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const vendor = buildVendor({});
    const { service } = buildServiceWithManager({
      vendor,
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const resendKey = newIdempotencyKey();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        service.resend(
          { id: ADMIN_ID } as never,
          'resend-unknown-printer',
          { operationPassword: 'pw' },
          resendKey,
        ),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
      );
    }

    expect(repository.repo.save).not.toHaveBeenCalled();
    expect(vendor.print).not.toHaveBeenCalled();
    expect(vendor.queryOnline).not.toHaveBeenCalled();
    expect(idempotency.records).toHaveLength(2);
    expect(idempotency.records[0]).toMatchObject({ status: 'UNKNOWN' });
    expect(idempotency.records[1]).toMatchObject({ status: 'FAILED' });
  });

  it('does not block resend on same UUID candidates when bindingOperationId targets a terminal record', async () => {
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const sharedKey = newIdempotencyKey();
    repository.rows.push({
      id: 'resend-precise-printer',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.ERROR,
      bindingStage: PrinterBindingStage.RECONCILIATION,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: sharedKey,
      bindingOperationId: 'target-terminal',
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    } as CloudPrinter);
    idempotency.records.push(
      {
        id: 'target-terminal',
        adminId: ADMIN_ID,
        operation: 'CLOUD_PRINTER_BIND',
        key: sharedKey,
        requestHash: 'a'.repeat(64),
        status: 'FAILED',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'resend-precise-printer',
        responseSnapshot: {
          printerId: 'resend-precise-printer',
          code: 'RECOVERY_REQUIRED',
        },
      },
      {
        id: 'cross-operation-unknown',
        adminId: 'other-admin',
        operation: 'CLOUD_PRINTER_RESEND',
        key: sharedKey,
        requestHash: 'b'.repeat(64),
        status: 'UNKNOWN',
        resourceType: 'CLOUD_PRINTER',
        resourceId: 'resend-precise-printer',
        responseSnapshot: null,
      },
    );
    const vendor = buildVendor({});
    const { service } = buildServiceWithManager({
      vendor,
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const newCycleKey = newIdempotencyKey();

    await expect(
      service.resend(
        { id: ADMIN_ID } as never,
        'resend-precise-printer',
        { operationPassword: 'pw' },
        newCycleKey,
      ),
    ).resolves.toMatchObject({ printer: { id: 'resend-precise-printer' } });
    expect(vendor.print).toHaveBeenCalledTimes(1);
    expect(repository.rows[0]).toMatchObject({
      bindingIdempotencyKey: newCycleKey,
      bindingOperationId: idempotency.records[2]?.id,
    });
    expect(idempotency.records[1]).toMatchObject({ status: 'UNKNOWN' });
  });

  it('persists and replays a stable FAILED not-found result without side effects', async () => {
    const vendor = buildVendor({});
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const { service } = buildServiceWithManager({
      vendor,
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const audit = serviceInternals(service).audit.record;
    const key = newIdempotencyKey();
    const request = { operationPassword: 'resend-not-found-secret' };

    await expect(
      service.resend({ id: ADMIN_ID } as never, '404', request, key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED),
    );
    await expect(
      service.resend({ id: ADMIN_ID } as never, '404', request, key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED),
    );

    expect(vendor.addPrinter).not.toHaveBeenCalled();
    expect(vendor.print).not.toHaveBeenCalled();
    expect(vendor.deletePrinter).not.toHaveBeenCalled();
    expect(vendor.queryOnline).not.toHaveBeenCalled();
    expect(repository.repo.save).not.toHaveBeenCalled();
    expect(idempotency.records).toHaveLength(1);
    expect(idempotency.records[0]).toMatchObject({
      status: 'FAILED',
      resourceType: null,
      resourceId: null,
      responseSnapshot: { code: 'RECOVERY_REQUIRED' },
    });
    expect(JSON.stringify(idempotency.records[0])).not.toContain(
      'resend-not-found-secret',
    );
    expect(audit).not.toHaveBeenCalled();
    await expectClassificationTransactionsCommitted(service);
  });

  it('keeps a failed final commit IN_PROGRESS, does not reprint, and fences it UNKNOWN after 120 seconds', async () => {
    let now = new Date('2026-08-04T00:00:00.000Z');
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    repository.rows.push({
      id: 'resend-fallback-printer',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      verificationCodeHash: await hashChallengeFixture('111111'),
      verificationExpiresAt: new Date(now.getTime() + 60_000),
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    } as CloudPrinter);
    const originalSave = repository.repo.save.getMockImplementation();
    repository.repo.save.mockImplementation(
      async (value: Partial<CloudPrinter>) => {
        if (
          value.status === CloudPrinterStatus.PENDING_VERIFICATION ||
          (value.status === CloudPrinterStatus.ERROR &&
            value.bindingStage === PrinterBindingStage.RECONCILIATION)
        ) {
          throw new Error('SQL password=resend-final-secret');
        }
        return (originalSave ?? (async () => ({}) as CloudPrinter))(value);
      },
    );
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-resend-final-failure',
    }));
    const queryOnline = vi.fn(async () => ({
      status: 'UNKNOWN' as const,
      vendorCode: '0',
    }));
    const { service } = buildServiceWithManager({
      vendor: buildVendor({ print, queryOnline }),
      repository,
      idempotencyRepository: idempotency.repository,
      now: () => now,
    });
    const key = newIdempotencyKey();
    const request = { operationPassword: 'resend-operation-secret' };

    const firstError = await service
      .resend(
        { id: ADMIN_ID } as never,
        'resend-fallback-printer',
        request,
        key,
      )
      .catch(
        (cause: unknown) => cause as { response?: unknown; message: string },
      );
    expect(firstError).toMatchObject({
      response: {
        code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
        message: '打印机操作正在处理中，请稍后重试',
      },
    });
    expect(JSON.stringify(firstError)).not.toMatch(
      /SQL|resend-final-secret|password=/u,
    );
    expect(idempotency.records[0]).toMatchObject({ status: 'IN_PROGRESS' });
    idempotency.records[0]!.updatedAt = new Date(now);

    await expect(
      service.resend(
        { id: ADMIN_ID } as never,
        'resend-fallback-printer',
        request,
        key,
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_IN_PROGRESS),
    );
    expect(print).toHaveBeenCalledTimes(1);
    expect(queryOnline).not.toHaveBeenCalled();

    now = new Date(now.getTime() + 120_000);
    await expect(
      service.resend(
        { id: ADMIN_ID } as never,
        'resend-fallback-printer',
        request,
        key,
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );

    expect(print).toHaveBeenCalledTimes(1);
    expect(queryOnline).toHaveBeenCalledTimes(1);
    expect(idempotency.records[0]).toMatchObject({ status: 'UNKNOWN' });
  });

  it('resend 将完整 SN、操作密码与新验证码传入 snapshot 校验路径', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    repository.rows.push({
      id: '10',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      verificationCodeHash: await hashChallengeFixture('111111'),
      verificationExpiresAt: new Date(Date.now() + 60_000),
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    } as CloudPrinter);
    const print = vi.fn(async () => ({
      classification: 'ACCEPTED' as const,
      vendorCode: '0',
      vendorJobId: 'job-sensitive-resend',
    }));
    const service = buildService({
      vendor: buildVendor({ print }),
      repository,
      idempotencyRepository,
    });
    const idempotency = (
      service as unknown as {
        idempotencyService: AdminOperationIdempotencyService;
      }
    ).idempotencyService;
    const complete = vi.spyOn(idempotency, 'complete');

    await service.resend(
      { id: ADMIN_ID } as never,
      '10',
      { operationPassword: 'resend-secret' },
      newIdempotencyKey(),
    );

    const challengePlaintext = firstPrintInput(print).content.replace(
      'ownership-code:',
      '',
    );
    expect(complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sensitiveValues: [SERIAL, 'resend-secret', challengePlaintext],
      }),
    );
  });
});

describe('CloudPrinterService.rename', () => {
  const SERIAL = 'SN-Rename-1';

  it('updates displayName with no operation password but normalizes whitespace', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const initialPrinter: Partial<CloudPrinter> = {
      id: 'printer-rename-1',
      serialNumber: SERIAL,
      displayName: '旧名',
      status: CloudPrinterStatus.ACTIVE,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      bindingOperationId: null,
      bindingOperation: null,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: new Date(),
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    };
    repository.rows.push(initialPrinter as CloudPrinter);

    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository,
    });

    const result: RenameCloudPrinterResult = await service.rename(
      { id: ADMIN_ID } as never,
      'printer-rename-1',
      { displayName: '  新名称  ' },
      newIdempotencyKey(),
    );

    expect(result.printer.displayName).toBe('新名称');
  });

  it('rename 在 snapshot 校验前以稳定错误码拒绝完整 SN displayName', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    repository.rows.push({
      id: 'printer-rename-sensitive',
      serialNumber: SERIAL,
      displayName: '旧名',
      status: CloudPrinterStatus.ACTIVE,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      bindingOperationId: null,
      bindingOperation: null,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: new Date(),
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    } as CloudPrinter);
    const service = buildService({ repository, idempotencyRepository });
    const rejection = await service
      .rename(
        { id: ADMIN_ID } as never,
        'printer-rename-sensitive',
        { displayName: SERIAL },
        newIdempotencyKey(),
      )
      .catch((error: unknown) => error);

    expect(rejection).toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_NAME_INVALID),
    );
    expect((rejection as Error).message).not.toContain(SERIAL);
    expect(idempotencyRepository.insert).not.toHaveBeenCalled();
    expect(repository.repo.save).not.toHaveBeenCalled();
  });

  it.each([SERIAL, `门店-${SERIAL.toLowerCase()}-前台`])(
    'rejects a display name containing the full serial before claim or mutation: %s',
    async (displayName) => {
      const repository = buildPrinterRepository();
      const idempotency = buildIdempotencyRepository();
      repository.rows.push({
        id: 'printer-rename-leak',
        serialNumber: SERIAL,
        displayName: '旧名',
        status: CloudPrinterStatus.ACTIVE,
        bindingStage: PrinterBindingStage.NONE,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
        bindingIdempotencyKey: null,
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationFailedAttempts: 0,
        verifiedAt: new Date(),
        lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
        lastStatusCheckedAt: null,
        boundByAdminId: ADMIN_ID,
        lastVendorErrorCode: null,
        unboundAt: null,
        version: 1,
      } as CloudPrinter);
      const { service } = buildServiceWithManager({
        repository,
        idempotencyRepository: idempotency.repository,
      });

      await expect(
        service.rename(
          { id: ADMIN_ID } as never,
          'printer-rename-leak',
          { displayName },
          newIdempotencyKey(),
        ),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.CLOUD_PRINTER_NAME_INVALID),
      );

      expect(idempotency.records).toHaveLength(0);
      expect(repository.repo.save).not.toHaveBeenCalled();
      expect(serviceInternals(service).audit.record).not.toHaveBeenCalled();
    },
  );

  it('persists and replays the exact same stable not-found response', async () => {
    const repository = buildPrinterRepository();
    const idempotency = buildIdempotencyRepository();
    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository: idempotency.repository,
    });
    const key = newIdempotencyKey();
    const request = { displayName: '不存在设备' };

    const first = (await service
      .rename({ id: ADMIN_ID } as never, '404', request, key)
      .then(() => {
        throw new Error('Expected rename to reject.');
      })
      .catch((error: unknown) => error)) as {
      status: number;
      response: unknown;
    };
    const second = (await service
      .rename({ id: ADMIN_ID } as never, '404', request, key)
      .then(() => {
        throw new Error('Expected rename replay to reject.');
      })
      .catch((error: unknown) => error)) as {
      status: number;
      response: unknown;
    };

    expect(first.status).toBe(404);
    expect(second.status).toBe(first.status);
    expect(second.response).toEqual(first.response);
    expect(first.response).toEqual({
      code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
      message: 'printer not found',
    });
    expect(idempotency.records).toHaveLength(1);
    expect(idempotency.records[0]).toMatchObject({
      status: 'FAILED',
      responseSnapshot: { code: 'NOT_FOUND' },
    });
    expect(repository.repo.save).not.toHaveBeenCalled();
  });

  it('rejects invalid display names', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    const initialPrinter: Partial<CloudPrinter> = {
      id: 'printer-rename-2',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.ACTIVE,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      bindingOperationId: null,
      bindingOperation: null,
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
      lastStatusCheckedAt: null,
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    };
    repository.rows.push(initialPrinter as CloudPrinter);

    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository,
    });

    await expect(
      service.rename(
        { id: ADMIN_ID } as never,
        'printer-rename-2',
        { displayName: '' },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expect.objectContaining({
        response: expect.objectContaining({ code: expect.any(String) }),
      }),
    );
  });
});

describe('CloudPrinterService.list and query', () => {
  const SERIAL = 'SN-List-1';
  const NOW = new Date('2026-08-04T00:00:30.000Z');

  const onlinePrinter = (lastStatusCheckedAt: Date | null): CloudPrinter => ({
    id: 'online-printer',
    serialNumber: SERIAL,
    displayName: '前台',
    status: CloudPrinterStatus.ACTIVE,
    bindingStage: PrinterBindingStage.NONE,
    vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    bindingIdempotencyKey: null,
    verificationCodeHash: null,
    verificationExpiresAt: null,
    verificationFailedAttempts: 0,
    verifiedAt: new Date(),
    lastOnlineStatus: CloudPrinterOnlineStatus.ONLINE,
    lastStatusCheckedAt,
    boundByAdminId: ADMIN_ID,
    boundByAdmin: {} as CloudPrinter['boundByAdmin'],
    lastVendorErrorCode: null,
    unboundAt: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('refreshStatus uses cache below 30 seconds without querying the vendor', async () => {
    const repository = buildPrinterRepository([
      onlinePrinter(new Date(NOW.getTime() - 29_999)),
    ]);
    const idempotency = buildIdempotencyRepository();
    const queryOnline = vi.fn();
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
      vendor: buildVendor({ queryOnline }),
      now: () => NOW,
    });

    const result = await service.refreshStatus(
      { id: ADMIN_ID } as never,
      'online-printer',
      newIdempotencyKey(),
    );

    expect(result.printer.onlineStatus).toBe(CloudPrinterOnlineStatus.ONLINE);
    expect(queryOnline).not.toHaveBeenCalled();
    expect(idempotency.records[0]).toMatchObject({ status: 'COMPLETED' });
  });

  it('refreshStatus treats exactly 30 seconds as stale and queries outside transactions', async () => {
    const repository = buildPrinterRepository([
      onlinePrinter(new Date(NOW.getTime() - 30_000)),
    ]);
    const idempotency = buildIdempotencyRepository();
    const queryOnline = vi.fn(async () => ({
      status: 'OFFLINE' as const,
      vendorCode: '0',
    }));
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
      vendor: buildVendor({ queryOnline }),
      now: () => NOW,
    });

    const result = await service.refreshStatus(
      { id: ADMIN_ID } as never,
      'online-printer',
      newIdempotencyKey(),
    );

    expect(result.printer.onlineStatus).toBe(CloudPrinterOnlineStatus.OFFLINE);
    expect(queryOnline).toHaveBeenCalledTimes(1);
    expect(repository.rows[0]).toMatchObject({
      lastOnlineStatus: CloudPrinterOnlineStatus.OFFLINE,
      lastStatusCheckedAt: NOW,
    });
  });

  it('refreshStatus uses the same key to reconcile UNKNOWN to ONLINE with query-only vendor calls', async () => {
    const repository = buildPrinterRepository([
      {
        ...onlinePrinter(null),
        bindingOperationId: 'binding-cycle-1',
      },
    ]);
    const idempotency = buildIdempotencyRepository();
    const queryOnline = vi
      .fn()
      .mockResolvedValueOnce({ status: 'UNKNOWN' as const, vendorCode: '0' })
      .mockResolvedValueOnce({ status: 'ONLINE' as const, vendorCode: '0' });
    const vendor = buildVendor({ queryOnline });
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
      vendor,
      now: () => NOW,
    });
    const key = newIdempotencyKey();

    await expect(
      service.refreshStatus({ id: ADMIN_ID } as never, 'online-printer', key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_ONLINE_STATUS_UNKNOWN),
    );
    const result = await service.refreshStatus(
      { id: ADMIN_ID } as never,
      'online-printer',
      key,
    );

    expect(result.printer.onlineStatus).toBe(CloudPrinterOnlineStatus.ONLINE);
    expect(queryOnline).toHaveBeenCalledTimes(2);
    expect(vendor.addPrinter).not.toHaveBeenCalled();
    expect(vendor.print).not.toHaveBeenCalled();
    expect(vendor.deletePrinter).not.toHaveBeenCalled();
    expect(repository.rows[0]).toMatchObject({
      lastOnlineStatus: CloudPrinterOnlineStatus.ONLINE,
      lastStatusCheckedAt: NOW,
    });
    expect(idempotency.records[0]).toMatchObject({ status: 'COMPLETED' });
  });

  it('refreshStatus keeps same-key repeated UNKNOWN recoverable instead of creating a dead key', async () => {
    const repository = buildPrinterRepository([
      {
        ...onlinePrinter(null),
        bindingOperationId: 'binding-cycle-1',
      },
    ]);
    const idempotency = buildIdempotencyRepository();
    const queryOnline = vi.fn(async () => ({
      status: 'UNKNOWN' as const,
      vendorCode: '0',
    }));
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
      vendor: buildVendor({ queryOnline }),
      now: () => NOW,
    });
    const key = newIdempotencyKey();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        service.refreshStatus({ id: ADMIN_ID } as never, 'online-printer', key),
      ).rejects.toMatchObject(
        expectApiCode(ApiErrorCode.CLOUD_PRINTER_ONLINE_STATUS_UNKNOWN),
      );
    }

    expect(queryOnline).toHaveBeenCalledTimes(2);
    expect(repository.repo.save).not.toHaveBeenCalled();
    expect(idempotency.records[0]).toMatchObject({
      status: 'UNKNOWN',
      responseSnapshot: {
        printerId: 'online-printer',
        bindingOperationId: 'binding-cycle-1',
        version: expect.any(Number),
      },
    });
  });

  it('refreshStatus does not let an old UNKNOWN query overwrite a new binding cycle', async () => {
    const repository = buildPrinterRepository([
      {
        ...onlinePrinter(null),
        bindingOperationId: 'binding-cycle-1',
      },
    ]);
    const idempotency = buildIdempotencyRepository();
    const queryOnline = vi
      .fn()
      .mockResolvedValueOnce({ status: 'UNKNOWN' as const, vendorCode: '0' })
      .mockImplementationOnce(async () => {
        repository.rows[0] = {
          ...repository.rows[0]!,
          bindingOperationId: 'binding-cycle-2',
          version: repository.rows[0]!.version + 1,
          lastOnlineStatus: CloudPrinterOnlineStatus.OFFLINE,
        };
        return { status: 'ONLINE' as const, vendorCode: '0' };
      });
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
      vendor: buildVendor({ queryOnline }),
      now: () => NOW,
    });
    const key = newIdempotencyKey();

    await expect(
      service.refreshStatus({ id: ADMIN_ID } as never, 'online-printer', key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_ONLINE_STATUS_UNKNOWN),
    );
    await expect(
      service.refreshStatus({ id: ADMIN_ID } as never, 'online-printer', key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED),
    );

    expect(repository.rows[0]).toMatchObject({
      bindingOperationId: 'binding-cycle-2',
      lastOnlineStatus: CloudPrinterOnlineStatus.OFFLINE,
    });
    expect(idempotency.records[0]).toMatchObject({ status: 'FAILED' });
    expect(queryOnline).toHaveBeenCalledTimes(2);
  });

  it('refreshStatus does not allow a new key to bypass an UNKNOWN refresh', async () => {
    const repository = buildPrinterRepository([onlinePrinter(null)]);
    const idempotency = buildIdempotencyRepository();
    const queryOnline = vi.fn(async () => ({
      status: 'UNKNOWN' as const,
      vendorCode: '0',
    }));
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
      vendor: buildVendor({ queryOnline }),
      now: () => NOW,
    });

    await expect(
      service.refreshStatus(
        { id: ADMIN_ID } as never,
        'online-printer',
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_ONLINE_STATUS_UNKNOWN),
    );
    await expect(
      service.refreshStatus(
        { id: ADMIN_ID } as never,
        'online-printer',
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN),
    );

    expect(queryOnline).toHaveBeenCalledTimes(1);
  });

  it('refreshStatus keeps hash conflicts when the same key targets another printer', async () => {
    const repository = buildPrinterRepository([onlinePrinter(null)]);
    const idempotency = buildIdempotencyRepository();
    const queryOnline = vi.fn(async () => ({
      status: 'UNKNOWN' as const,
      vendorCode: '0',
    }));
    const service = buildService({
      repository,
      idempotencyRepository: idempotency.repository,
      vendor: buildVendor({ queryOnline }),
      now: () => NOW,
    });
    const key = newIdempotencyKey();

    await expect(
      service.refreshStatus({ id: ADMIN_ID } as never, 'online-printer', key),
    ).rejects.toMatchObject(
      expectApiCode(ApiErrorCode.CLOUD_PRINTER_ONLINE_STATUS_UNKNOWN),
    );
    await expect(
      service.refreshStatus({ id: ADMIN_ID } as never, 'other-printer', key),
    ).rejects.toMatchObject(expectApiCode(ApiErrorCode.IDEMPOTENCY_CONFLICT));

    expect(queryOnline).toHaveBeenCalledTimes(1);
  });

  it('returns masked records without full serial numbers and safe challenge metadata', async () => {
    const repository = buildPrinterRepository();
    const idempotencyRepository = buildIdempotencyRepository().repository;
    repository.rows.push({
      id: '10',
      serialNumber: SERIAL,
      displayName: '前台',
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      bindingIdempotencyKey: null,
      bindingOperationId: '10',
      bindingOperation: null,
      verificationCodeHash: 'bcrypt-hash-must-not-leak',
      verificationExpiresAt: new Date('2026-08-04T00:05:00.000Z'),
      verificationFailedAttempts: 2,
      verifiedAt: null,
      lastOnlineStatus: CloudPrinterOnlineStatus.ONLINE,
      lastStatusCheckedAt: new Date(),
      boundByAdminId: ADMIN_ID,
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CloudPrinter);

    const { service } = buildServiceWithManager({
      repository,
      idempotencyRepository,
    });

    const result = await service.list({
      page: 1,
      pageSize: 10,
      includeUnbound: false,
    });

    const serialized = JSON.stringify(result);
    expect(result.items[0]?.challenge).toEqual({
      challengeId: '10',
      expiresAt: '2026-08-04T00:05:00.000Z',
      remainingAttempts: 3,
    });
    expect(serialized).not.toContain(SERIAL);
    expect(serialized).not.toContain('bcrypt-hash-must-not-leak');
    expect(result.items[0]).not.toHaveProperty('serialNumber');
    expect(result.items[0]?.challenge).not.toHaveProperty('code');
    expect(result.items[0]?.challenge).not.toHaveProperty(
      'verificationCodeHash',
    );
  });

  it('omits challenge metadata when any required field is missing or the status is not verifiable', () => {
    const base = {
      ...onlinePrinter(null),
      status: CloudPrinterStatus.PENDING_VERIFICATION,
      verificationCodeHash: 'hash',
      verificationExpiresAt: new Date('2026-08-04T00:05:00.000Z'),
      verificationFailedAttempts: 8,
    };

    expect(toView(base).challenge?.remainingAttempts).toBe(0);
    expect(toView({ ...base, verificationCodeHash: null })).not.toHaveProperty(
      'challenge',
    );
    expect(toView({ ...base, verificationExpiresAt: null })).not.toHaveProperty(
      'challenge',
    );
    expect(
      toView({ ...base, status: CloudPrinterStatus.ACTIVE }),
    ).not.toHaveProperty('challenge');
  });
});

describe('CloudPrinterService normalization helpers', () => {
  it.each([
    [' SN-AbC-123 ', 'SN-AbC-123'],
    ['a', 'a'],
  ])('normalizes serial %j to %j', (input, expected) => {
    expect(normalizeCloudPrinterSerialNumber(input)).toBe(expected);
  });

  it('normalizes display name with whitespace', () => {
    expect(normalizeCloudPrinterDisplayName(' 前台 ')).toBe('前台');
  });
});
