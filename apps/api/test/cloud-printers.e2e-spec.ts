import 'reflect-metadata';

import {
  AdminPermission,
  AdminRole,
  ApiErrorCode,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
} from '@bake-mall/contracts';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { AdminPermissionGuard } from '../src/auth/admin-permission.guard.js';
import { JwtAdminGuard } from '../src/auth/admin-jwt.guard.js';
import { type AuthenticatedAdmin } from '../src/auth/auth.types.js';
import { AdminVerificationService } from '../src/auth/admin-verification.service.js';
import { CloudPrinter } from '../src/database/entities/cloud-printer.entity.js';
import { AdminCloudPrintersController } from '../src/printing/admin-cloud-printers.controller.js';
import { AdminOperationIdempotencyService } from '../src/printing/admin-operation-idempotency.service.js';
import { CloudPrinterReconciliationService } from '../src/printing/cloud-printer-reconciliation.service.js';
import { createAdminOperationIdempotencyTestService } from './helpers/admin-operation-idempotency.js';
import { CloudPrinterService } from '../src/printing/cloud-printer.service.js';

const operatorPrincipal: AuthenticatedAdmin = {
  id: '42',
  username: null,
  role: AdminRole.OPERATOR,
  linkedUserId: '7',
  mustChangePassword: false,
  permissions: OPERATOR_PERMISSIONS,
};

const superAdminPrincipal: AuthenticatedAdmin = {
  id: '43',
  username: 'admin@example.com',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  mustChangePassword: false,
  permissions: SUPER_ADMIN_PERMISSIONS,
};

const deniedOperatorPrincipal: AuthenticatedAdmin = {
  ...operatorPrincipal,
  permissions: operatorPrincipal.permissions.filter(
    (permission) => permission !== AdminPermission.PRINT_DEVICE_MANAGE,
  ),
};

describe.sequential('Admin cloud printers controller (e2e)', () => {
  let app: INestApplication | undefined;
  const vendorCalls = {
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
  const printerRows: Record<string, unknown>[] = [];
  const idempotencyRows: Record<string, unknown>[] = [];
  const auditLog = { record: vi.fn().mockResolvedValue(undefined) };
  const verification = {
    verifyPassword: vi.fn(async () => ({
      status: 'VERIFIED' as const,
      admin: { id: '42' } as never,
    })),
  };

  const buildPrinterRepo = () => ({
    findOne: vi.fn(
      async ({ where }: { where?: Readonly<Record<string, unknown>> } = {}) =>
        printerRows.find((row) =>
          Object.entries(where ?? {}).every(
            ([key, value]) => row[key] === value,
          ),
        ) ?? null,
    ),
    find: vi.fn(async () => printerRows),
    save: vi.fn(async (value: Record<string, unknown>) => {
      const id = value.id ?? String(printerRows.length + 1);
      const saved = { ...value, id };
      const index = printerRows.findIndex((row) => row.id === saved.id);
      if (index >= 0) printerRows[index] = saved;
      else printerRows.push(saved);
      return saved;
    }),
    update: vi.fn(async () => ({ affected: 1 })),
    create: vi.fn((value: Record<string, unknown> = {}) => value),
  });

  const buildIdempotencyRepo = () => ({
    insert: vi.fn(async (value: Record<string, unknown>) => {
      const duplicate = idempotencyRows.some(
        (record) =>
          record.adminId === value.adminId &&
          record.operation === value.operation &&
          record.key === value.key,
      );
      if (duplicate)
        throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      const id = String(idempotencyRows.length + 1);
      idempotencyRows.push({ id, ...value });
      return { identifiers: [{ id }] };
    }),
    findOne: vi.fn(
      async ({ where }: { where: Readonly<Record<string, unknown>> }) =>
        idempotencyRows.find((record) =>
          Object.entries(where).every(([key, value]) => record[key] === value),
        ) ?? null,
    ),
    find: vi.fn(
      async ({ where }: { where: Readonly<Record<string, unknown>> }) =>
        idempotencyRows.filter((record) =>
          Object.entries(where).every(([key, value]) => record[key] === value),
        ),
    ),
    update: vi.fn(
      async (
        where: Readonly<Record<string, unknown>>,
        values: Readonly<Record<string, unknown>>,
      ) => {
        const matching = idempotencyRows.filter((record) =>
          Object.entries(where).every(([key, value]) => record[key] === value),
        );
        matching.forEach((record) => Object.assign(record, values));
        return { affected: matching.length };
      },
    ),
  });

  const printerRepo = buildPrinterRepo();
  const idempotencyRepo = buildIdempotencyRepo();
  const getRepository = vi.fn((entity: unknown) => {
    if (entity === CloudPrinter) return printerRepo;
    return idempotencyRepo;
  });
  const advisoryLocks = new Set<string>();
  const dataSource = {
    getRepository,
    transaction: vi.fn(
      async (operation: (manager: unknown) => Promise<unknown>) =>
        operation({ getRepository }),
    ),
    createQueryRunner: vi.fn(() => {
      let heldLock: string | null = null;
      return {
        connect: vi.fn(),
        release: vi.fn(),
        query: vi.fn(async (sql: string, parameters: string[]) => {
          const lock = parameters[0]!;
          if (sql.includes('GET_LOCK')) {
            if (advisoryLocks.has(lock)) return [{ acquired: 0 }];
            advisoryLocks.add(lock);
            heldLock = lock;
            return [{ acquired: 1 }];
          }
          if (sql.includes('RELEASE_LOCK')) {
            if (heldLock) advisoryLocks.delete(heldLock);
            heldLock = null;
            return [{ released: 1 }];
          }
          throw new Error(`unexpected SQL: ${sql}`);
        }),
      };
    }),
  } as never;

  const idempotencyService = createAdminOperationIdempotencyTestService(
    {} as never,
  );
  const verificationService = verification as never;
  const cloudPrinters = new CloudPrinterService(
    dataSource,
    verificationService,
    auditLog as never,
    idempotencyService,
    vendorCalls,
  );
  const reconciliation = new CloudPrinterReconciliationService(
    dataSource,
    verificationService,
    auditLog as never,
    idempotencyService,
    vendorCalls,
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminCloudPrintersController],
      providers: [
        Reflector,
        AdminPermissionGuard,
        {
          provide: AdminOperationIdempotencyService,
          useValue: idempotencyService,
        },
        { provide: CloudPrinterService, useValue: cloudPrinters },
        {
          provide: CloudPrinterReconciliationService,
          useValue: reconciliation,
        },
        { provide: AuditService, useValue: auditLog },
        { provide: AdminVerificationService, useValue: verification },
      ],
    })
      .overrideGuard(JwtAdminGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): { getRequest(): { headers: Record<string, string> } };
        }) => {
          const req = context.switchToHttp().getRequest() as {
            admin?: AuthenticatedAdmin;
            headers: Record<string, string>;
          };
          req.admin =
            req.headers['x-test-role'] === AdminRole.SUPER_ADMIN
              ? superAdminPrincipal
              : req.headers['x-test-permission'] === 'denied'
                ? deniedOperatorPrincipal
                : operatorPrincipal;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('OPERATOR has PRINT_DEVICE_MANAGE and may bind; response excludes full serial', async () => {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/bind')
      .set('idempotency-key', '00000000-0000-4000-8000-000000000101')
      .set('x-test-role', AdminRole.OPERATOR)
      .send({
        serialNumber: 'SN-Demo-1',
        displayName: '前台',
        operationPassword: 'pw',
      });

    expect(response.status).toBe(201);
    expect(response.body.printer).not.toHaveProperty('serialNumber');
    expect(response.body.printer.serialNumberMasked).toMatch(/^SN\*+-1$/u);
    expect(JSON.stringify(response.body)).not.toContain('SN-Demo-1');
    expect(response.body.challenge).toMatchObject({ remainingAttempts: 5 });
    expect(response.body.printer.challenge).toEqual(response.body.challenge);
    expect(response.body.printer.challenge).not.toHaveProperty('code');
    expect(response.body.printer.challenge).not.toHaveProperty(
      'verificationCodeHash',
    );
    expect(response.body.printer.status).toBe('PENDING_VERIFICATION');
  });

  it('lists current challenge metadata without code, hash, or full serial number', async () => {
    const expiresAt = new Date('2026-08-09T14:05:00.000Z');
    printerRows.push({
      id: '9050',
      serialNumber: 'SN-Challenge-Http',
      displayName: '前台-SN-Challenge-Http',
      status: 'PENDING_VERIFICATION',
      bindingStage: 'NONE',
      vendorRelationState: 'CONFIRMED_BOUND',
      bindingIdempotencyKey: '00000000-0000-4000-8000-000000009050',
      bindingOperationId: '9050',
      verificationCodeHash: 'bcrypt-hash-must-not-leak',
      verificationExpiresAt: expiresAt,
      verificationFailedAttempts: 2,
      verifiedAt: null,
      lastOnlineStatus: 'UNKNOWN',
      lastStatusCheckedAt: null,
      boundByAdminId: '42',
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    });

    const response = await request(app!.getHttpServer())
      .get('/api/v1/admin/cloud-printers?page=1&pageSize=100')
      .set('x-test-role', AdminRole.OPERATOR);

    expect(response.status).toBe(200);
    const printer = response.body.items.find(
      (item: { id: string }) => item.id === '9050',
    );
    expect(printer).toMatchObject({
      id: '9050',
      displayName: expect.not.stringContaining('SN-Challenge-Http'),
      challenge: {
        challengeId: '9050',
        expiresAt: expiresAt.toISOString(),
        remainingAttempts: 3,
      },
    });
    expect(printer).not.toHaveProperty('serialNumber');
    expect(printer.challenge).not.toHaveProperty('code');
    expect(printer.challenge).not.toHaveProperty('hash');
    expect(printer.challenge).not.toHaveProperty('verificationCodeHash');
    expect(JSON.stringify(response.body)).not.toContain('SN-Challenge-Http');
    expect(JSON.stringify(response.body)).not.toContain(
      'bcrypt-hash-must-not-leak',
    );
  });

  it('rejects mismatched confirm path and body challenge ids with 422 before verification or idempotency claim', async () => {
    const beforeVerification = verification.verifyPassword.mock.calls.length;
    const beforeOperations = idempotencyRows.length;

    const response = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/9050/verification/confirm')
      .set('idempotency-key', '00000000-0000-4000-8000-000000009051')
      .set('x-test-role', AdminRole.OPERATOR)
      .send({
        challengeId: '9051',
        code: '123456',
        operationPassword: 'pw',
      });

    expect(response.status).toBe(422);
    expect(verification.verifyPassword).toHaveBeenCalledTimes(
      beforeVerification,
    );
    expect(idempotencyRows).toHaveLength(beforeOperations);
  });

  it('rejects bind without Idempotency-Key header', async () => {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/bind')
      .set('x-test-role', AdminRole.SUPER_ADMIN)
      .send({
        serialNumber: 'SN-Demo-2',
        displayName: '前台',
        operationPassword: 'pw',
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ApiErrorCode.IDEMPOTENCY_CONFLICT);
  });

  it('rejects non-canonical uppercase UUID before persistence', async () => {
    const beforeRows = idempotencyRows.length;
    const response = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/bind')
      .set('idempotency-key', '00000000-0000-4000-8000-00000000000A')
      .set('x-test-role', AdminRole.SUPER_ADMIN)
      .send({
        serialNumber: 'SN-Invalid-Key',
        displayName: '前台',
        operationPassword: 'pw',
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ApiErrorCode.IDEMPOTENCY_CONFLICT);
    expect(idempotencyRows).toHaveLength(beforeRows);
  });

  it('replays same key with same body and does not re-call vendor', async () => {
    const key = '00000000-0000-4000-8000-000000000102';
    const beforeAdd = vendorCalls.addPrinter.mock.calls.length;
    const beforePrint = vendorCalls.print.mock.calls.length;
    const first = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/bind')
      .set('idempotency-key', key)
      .set('x-test-role', AdminRole.SUPER_ADMIN)
      .send({
        serialNumber: 'SN-Replay-1',
        displayName: '前台',
        operationPassword: 'pw',
      });
    expect(first.status).toBe(201);
    expect(vendorCalls.addPrinter.mock.calls.length).toBe(beforeAdd + 1);
    expect(vendorCalls.print.mock.calls.length).toBe(beforePrint + 1);

    const second = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/bind')
      .set('idempotency-key', key)
      .set('x-test-role', AdminRole.SUPER_ADMIN)
      .send({
        serialNumber: 'SN-Replay-1',
        displayName: '前台',
        operationPassword: 'pw',
      });
    expect(second.status).toBe(201);
    expect(vendorCalls.addPrinter.mock.calls.length).toBe(beforeAdd + 1);
    expect(vendorCalls.print.mock.calls.length).toBe(beforePrint + 1);
  });

  it('returns stable HTTP/API codes for add vendor failures and replays without a second vendor call', async () => {
    const cases = [
      ['1010', 400, ApiErrorCode.CLOUD_PRINTER_SERIAL_INVALID],
      ['1001', 409, ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT],
      ['1022', 409, ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT],
      ['1033', 409, ApiErrorCode.CLOUD_PRINTER_VENDOR_LIMIT],
      ['1003', 409, ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED],
    ] as const;

    for (const [index, [vendorCode, status, apiCode]] of cases.entries()) {
      const serialNumber = `SN-Vendor-Http-${index}`;
      const key = `00000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`;
      const beforeAdd = vendorCalls.addPrinter.mock.calls.length;
      vendorCalls.addPrinter.mockRejectedValueOnce(
        Object.assign(new Error(`raw-vendor-${vendorCode}`), {
          classification: 'FAILED',
          vendorCode,
        }),
      );
      const send = () =>
        request(app!.getHttpServer())
          .post('/api/v1/admin/cloud-printers/bind')
          .set('idempotency-key', key)
          .set('x-test-role', AdminRole.SUPER_ADMIN)
          .send({ serialNumber, displayName: '前台', operationPassword: 'pw' });

      const first = await send();
      const replay = await send();

      expect(first.status).toBe(status);
      expect(replay.status).toBe(status);
      expect(first.body.code).toBe(apiCode);
      expect(replay.body).toEqual(first.body);
      expect(vendorCalls.addPrinter).toHaveBeenCalledTimes(beforeAdd + 1);
      const operation = idempotencyRows.find(
        (row) => row.operation === 'CLOUD_PRINTER_BIND' && row.key === key,
      );
      expect(operation).toMatchObject({
        status: 'FAILED',
        responseSnapshot: {
          printerId: expect.any(String),
          code: expect.any(String),
        },
      });
      expect(
        Object.keys((operation?.responseSnapshot ?? {}) as object).sort(),
      ).toEqual(['code', 'printerId']);
      expect(JSON.stringify(operation?.responseSnapshot)).not.toContain(
        serialNumber,
      );
      expect(JSON.stringify(operation?.responseSnapshot)).not.toContain(
        `raw-vendor-${vendorCode}`,
      );
    }
  });

  it('rename updates display name and rejects without Idempotency-Key', async () => {
    printerRows.push({
      id: '900',
      serialNumber: 'SN-Rename-E2E',
      displayName: '旧名',
      status: 'ACTIVE',
      bindingStage: 'NONE',
      vendorRelationState: 'CONFIRMED_BOUND',
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationFailedAttempts: 0,
      verifiedAt: new Date(),
      lastOnlineStatus: 'UNKNOWN',
      lastStatusCheckedAt: null,
      boundByAdminId: '42',
      lastVendorErrorCode: null,
      unboundAt: null,
      version: 1,
    });

    const response = await request(app!.getHttpServer())
      .patch('/api/v1/admin/cloud-printers/900/display-name')
      .set('idempotency-key', '00000000-0000-4000-8000-000000000103')
      .set('x-test-role', AdminRole.SUPER_ADMIN)
      .send({ displayName: '  新名称  ' });

    expect(response.status).toBe(200);
    expect(response.body.printer.displayName).toBe('新名称');
    expect(JSON.stringify(response.body)).not.toContain('SN-Rename-E2E');

    const noKey = await request(app!.getHttpServer())
      .patch('/api/v1/admin/cloud-printers/900/display-name')
      .set('x-test-role', AdminRole.SUPER_ADMIN)
      .send({ displayName: '跳过' });
    expect(noKey.status).toBe(400);
    expect(noKey.body.code).toBe(ApiErrorCode.IDEMPOTENCY_CONFLICT);
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['65 emoji', '😀'.repeat(65)],
    ['full serial', 'SN-Name-Http'],
  ] as const)(
    'returns one domain name error for bind and rename %s without side effects',
    async (_case, displayName) => {
      const serialNumber = 'SN-Name-Http';
      printerRows.push({
        id: '901',
        serialNumber,
        displayName: '旧名',
        status: 'ACTIVE',
        bindingStage: 'NONE',
        vendorRelationState: 'CONFIRMED_BOUND',
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationFailedAttempts: 0,
        verifiedAt: new Date(),
        lastOnlineStatus: 'UNKNOWN',
        lastStatusCheckedAt: null,
        boundByAdminId: '42',
        lastVendorErrorCode: null,
        unboundAt: null,
        version: 1,
      });
      const before = {
        claims: idempotencyRows.length,
        printers: printerRows.length,
        vendor: Object.values(vendorCalls).map(
          (call) => call.mock.calls.length,
        ),
        audit: auditLog.record.mock.calls.length,
      };
      const bind = await request(app!.getHttpServer())
        .post('/api/v1/admin/cloud-printers/bind')
        .set('idempotency-key', '00000000-0000-4000-8000-000000000106')
        .set('x-test-role', AdminRole.SUPER_ADMIN)
        .send({ serialNumber, displayName, operationPassword: 'pw' });
      const rename = await request(app!.getHttpServer())
        .patch('/api/v1/admin/cloud-printers/901/display-name')
        .set('idempotency-key', '00000000-0000-4000-8000-000000000107')
        .set('x-test-role', AdminRole.SUPER_ADMIN)
        .send({ displayName });

      expect(bind.status).toBe(400);
      expect(rename.status).toBe(bind.status);
      expect(bind.body.code).toBe(ApiErrorCode.CLOUD_PRINTER_NAME_INVALID);
      expect(rename.body.code).toBe(bind.body.code);
      expect(idempotencyRows).toHaveLength(before.claims);
      expect(printerRows).toHaveLength(before.printers);
      expect(
        Object.values(vendorCalls).map((call) => call.mock.calls.length),
      ).toEqual(before.vendor);
      expect(auditLog.record).toHaveBeenCalledTimes(before.audit);
      expect(printerRows.find(({ id }) => id === '901')?.displayName).toBe(
        '旧名',
      );
      printerRows.splice(
        printerRows.findIndex(({ id }) => id === '901'),
        1,
      );
    },
  );

  it('rejects bind with invalid serial number (whitelist pattern)', async () => {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/bind')
      .set('idempotency-key', '00000000-0000-4000-8000-000000000104')
      .set('x-test-role', AdminRole.SUPER_ADMIN)
      .send({
        serialNumber: 'SN Invalid Space',
        displayName: '前台',
        operationPassword: 'pw',
      });
    expect(response.status).toBe(400);
  });

  it.each([
    {
      name: 'requery',
      path: '/api/v1/admin/cloud-printers/9201/vendor-relation/requery',
      body: { operationPassword: 'requery-denied-secret' },
      targetId: '9201',
    },
    {
      name: 'delete-confirm',
      path: '/api/v1/admin/cloud-printers/9202/compensation-delete/confirm',
      body: { operationPassword: 'delete-denied-secret' },
      targetId: '9202',
    },
    {
      name: 'refresh',
      path: '/api/v1/admin/cloud-printers/9203/online-status/refresh',
      body: {},
      targetId: '9203',
    },
    {
      name: 'bind',
      path: '/api/v1/admin/cloud-printers/bind',
      body: {
        serialNumber: 'SN-DENIED-PRIVATE',
        displayName: '拒绝设备',
        operationPassword: 'bind-denied-secret',
      },
      targetId: 'N/A',
    },
  ])(
    'audits one sanitized permission denial for $name before controller execution',
    async ({ path, body, targetId }) => {
      auditLog.record.mockClear();

      const response = await request(app!.getHttpServer())
        .post(path)
        .set('idempotency-key', '00000000-0000-4000-8000-000000000113')
        .set('x-test-role', AdminRole.OPERATOR)
        .set('x-test-permission', 'denied')
        .send(body);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ApiErrorCode.ADMIN_PERMISSION_DENIED);
      expect(auditLog.record).toHaveBeenCalledTimes(1);
      expect(auditLog.record).toHaveBeenCalledWith({
        actor: { type: 'ADMIN', adminUserId: '42' },
        targetEntity: 'admin_permissions',
        targetId,
        action: 'ADMIN_PERMISSION_DENIED',
        changeSummary: {
          requiredPermission: AdminPermission.PRINT_DEVICE_MANAGE,
          role: AdminRole.OPERATOR,
          result: 'DENIED',
        },
      });
      const serializedAudit = JSON.stringify(auditLog.record.mock.calls);
      expect(serializedAudit).not.toMatch(
        /SN-DENIED-PRIVATE|denied-secret|password|serialNumber|code|sign|token/iu,
      );
    },
  );

  it('exposes refresh/requery/delete-confirm with canonical keys, password forwarding, masked SN, and no unbind route', async () => {
    const recoveryPassword = 'recovery-http-secret';
    printerRows.push(
      {
        id: '9101',
        serialNumber: 'SN-Requery-Http',
        displayName: '恢复设备',
        status: 'ERROR',
        bindingStage: 'RECONCILIATION',
        vendorRelationState: 'UNKNOWN',
        bindingIdempotencyKey: null,
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationFailedAttempts: 0,
        verifiedAt: null,
        lastOnlineStatus: 'UNKNOWN',
        lastStatusCheckedAt: null,
        boundByAdminId: '42',
        lastVendorErrorCode: null,
        unboundAt: null,
        version: 1,
      },
      {
        id: '9102',
        serialNumber: 'SN-Delete-Http',
        displayName: '补偿设备',
        status: 'ERROR',
        bindingStage: 'COMPENSATION_DELETE',
        vendorRelationState: 'UNKNOWN',
        bindingIdempotencyKey: null,
        verificationCodeHash: 'challenge-hash',
        verificationExpiresAt: new Date(Date.now() + 60_000),
        verificationFailedAttempts: 1,
        verifiedAt: null,
        lastOnlineStatus: 'UNKNOWN',
        lastStatusCheckedAt: null,
        boundByAdminId: '42',
        lastVendorErrorCode: null,
        unboundAt: null,
        version: 1,
      },
      {
        id: '9103',
        serialNumber: 'SN-Refresh-Http',
        displayName: '在线设备',
        status: 'ACTIVE',
        bindingStage: 'NONE',
        vendorRelationState: 'CONFIRMED_BOUND',
        bindingIdempotencyKey: null,
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationFailedAttempts: 0,
        verifiedAt: new Date(),
        lastOnlineStatus: 'UNKNOWN',
        lastStatusCheckedAt: null,
        boundByAdminId: '42',
        lastVendorErrorCode: null,
        unboundAt: null,
        version: 1,
      },
    );
    verification.verifyPassword.mockClear();

    const requery = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/9101/vendor-relation/requery')
      .set('idempotency-key', '00000000-0000-4000-8000-000000000108')
      .set('x-test-role', AdminRole.OPERATOR)
      .send({ operationPassword: recoveryPassword });
    const deletion = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/9102/compensation-delete/confirm')
      .set('idempotency-key', '00000000-0000-4000-8000-000000000109')
      .set('x-test-role', AdminRole.OPERATOR)
      .send({ operationPassword: recoveryPassword });
    const refresh = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/9103/online-status/refresh')
      .set('idempotency-key', '00000000-0000-4000-8000-000000000110')
      .set('x-test-role', AdminRole.OPERATOR)
      .send();
    const invalidKey = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/9101/vendor-relation/requery')
      .set('idempotency-key', 'not-a-uuid')
      .set('x-test-role', AdminRole.OPERATOR)
      .send({ operationPassword: recoveryPassword });
    const missingPassword = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/9101/vendor-relation/requery')
      .set('idempotency-key', '00000000-0000-4000-8000-000000000111')
      .set('x-test-role', AdminRole.OPERATOR)
      .send({});
    const noUnbind = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/9101/unbind')
      .set('idempotency-key', '00000000-0000-4000-8000-000000000112')
      .set('x-test-role', AdminRole.OPERATOR)
      .send({ operationPassword: recoveryPassword });

    expect(requery.status).toBe(201);
    expect(deletion.status).toBe(201);
    expect(refresh.status).toBe(201);
    expect(invalidKey.status).toBe(400);
    expect(invalidKey.body.code).toBe(ApiErrorCode.IDEMPOTENCY_CONFLICT);
    expect(missingPassword.status).toBe(400);
    expect(noUnbind.status).toBe(404);
    expect(verification.verifyPassword).toHaveBeenCalledWith(
      expect.objectContaining({ candidatePassword: recoveryPassword }),
    );
    for (const response of [requery, deletion, refresh]) {
      expect(response.body.printer.serialNumberMasked).toEqual(
        expect.any(String),
      );
      expect(response.body.printer).not.toHaveProperty('serialNumber');
      expect(JSON.stringify(response.body)).not.toContain('SN-');
      expect(JSON.stringify(response.body)).not.toContain(recoveryPassword);
    }
  });

  it.each([
    [
      'confirm',
      'post',
      '/verification/confirm',
      { challengeId: '1', code: '123456', operationPassword: 'pw' },
    ],
    ['resend', 'post', '/verification/resend', { operationPassword: 'pw' }],
    [
      'requery',
      'post',
      '/vendor-relation/requery',
      { operationPassword: 'pw' },
    ],
    [
      'delete-confirm',
      'post',
      '/compensation-delete/confirm',
      { operationPassword: 'pw' },
    ],
    ['refresh', 'post', '/online-status/refresh', {}],
    ['rename', 'patch', '/display-name', { displayName: '新名称' }],
  ] as const)(
    'rejects every non-canonical unsigned bigint id before the %s service endpoint',
    async (_name, method, suffix, body) => {
      const invalidIds = [
        '0',
        '00',
        '01',
        '-1',
        '1.0',
        'abc',
        '18446744073709551616',
      ];
      const before = {
        operations: idempotencyRows.length,
        verification: verification.verifyPassword.mock.calls.length,
        vendor: Object.values(vendorCalls).map(
          (call) => call.mock.calls.length,
        ),
        audit: auditLog.record.mock.calls.length,
      };

      for (const [index, invalidId] of invalidIds.entries()) {
        const http = request(app!.getHttpServer());
        const response = await http[method](
          `/api/v1/admin/cloud-printers/${invalidId}${suffix}`,
        )
          .set(
            'idempotency-key',
            `00000000-0000-4000-8000-${String(800 + index).padStart(12, '0')}`,
          )
          .set('x-test-role', AdminRole.SUPER_ADMIN)
          .send(body);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
          message: 'Cloud printer id must be a canonical unsigned BIGINT',
        });
        expect(JSON.stringify(response.body)).not.toContain(invalidId);
      }

      expect(idempotencyRows).toHaveLength(before.operations);
      expect(verification.verifyPassword).toHaveBeenCalledTimes(
        before.verification,
      );
      expect(
        Object.values(vendorCalls).map((call) => call.mock.calls.length),
      ).toEqual(before.vendor);
      expect(auditLog.record).toHaveBeenCalledTimes(before.audit);
    },
  );

  it('accepts the maximum canonical unsigned bigint id unchanged at the HTTP boundary', async () => {
    const maximumId = '18446744073709551615';
    const response = await request(app!.getHttpServer())
      .patch(`/api/v1/admin/cloud-printers/${maximumId}/display-name`)
      .set('idempotency-key', '00000000-0000-4000-8000-000000000899')
      .set('x-test-role', AdminRole.SUPER_ADMIN)
      .send({ displayName: '最大 ID' });

    expect(response.status).toBe(404);
    expect(idempotencyRows).toContainEqual(
      expect.objectContaining({
        operation: 'CLOUD_PRINTER_RENAME',
        requestHash: idempotencyService.hashRequest({
          printerId: maximumId,
          displayName: '最大 ID',
        }),
      }),
    );
  });

  it('audit log records ADMIN actor with action and masked serial only', async () => {
    auditLog.record.mockClear();
    const response = await request(app!.getHttpServer())
      .post('/api/v1/admin/cloud-printers/bind')
      .set('idempotency-key', '00000000-0000-4000-8000-000000000105')
      .set('x-test-role', AdminRole.SUPER_ADMIN)
      .send({
        serialNumber: 'SN-Audit-1',
        displayName: '审计',
        operationPassword: 'pw',
      });
    expect(response.status).toBe(201);
    expect(auditLog.record).toHaveBeenCalled();
    const recorded = auditLog.record.mock.calls[0]?.[0];
    expect(recorded).toMatchObject({
      actor: { type: 'ADMIN', adminUserId: '43' },
      targetEntity: 'cloud_printers',
    });
    expect(JSON.stringify(recorded)).not.toContain('SN-Audit-1');
    expect(JSON.stringify(recorded)).not.toContain('pw');
  });
});
