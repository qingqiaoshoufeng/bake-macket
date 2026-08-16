import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  CLOUD_PRINTER_STORE_SCOPE,
  CloudPrinterStoreSetting,
} from '../database/entities/cloud-printer-store-setting.entity.js';
import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import { CloudPrinterCurrentService } from './cloud-printer-current.service.js';

const NOW = new Date('2026-08-16T00:00:00.000Z');
const ADMIN = { id: '7' } as never;
const PASSWORD = 'operation-password';
const KEY = '00000000-0000-4000-8000-000000000001';

const printer = (overrides: Partial<CloudPrinter> = {}): CloudPrinter =>
  ({
    id: '11',
    serialNumber: 'SN-Current-11',
    displayName: '后厨',
    status: CloudPrinterStatus.ACTIVE,
    bindingStage: PrinterBindingStage.NONE,
    vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    bindingIdempotencyKey: null,
    bindingOperationId: null,
    verificationCodeHash: null,
    verificationExpiresAt: null,
    verificationFailedAttempts: 0,
    verifiedAt: NOW,
    lastOnlineStatus: CloudPrinterOnlineStatus.OFFLINE,
    lastStatusCheckedAt: NOW,
    boundByAdminId: '7',
    lastVendorErrorCode: null,
    unboundAt: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }) as CloudPrinter;

const buildFixture = (input?: {
  currentPrinterId?: string | null;
  revision?: number;
  printers?: CloudPrinter[];
}) => {
  const printers = input?.printers ?? [printer()];
  const setting: CloudPrinterStoreSetting = {
    id: '1',
    scopeKey: CLOUD_PRINTER_STORE_SCOPE,
    currentPrinterId: input?.currentPrinterId ?? null,
    currentPrinter: null,
    revision: input?.revision ?? 1,
    updatedByAdminId: null,
    updatedByAdmin: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const settingRepository = {
    findOne: vi.fn(async () => ({ ...setting })),
    save: vi.fn(async (value: CloudPrinterStoreSetting) => {
      Object.assign(setting, value, { updatedAt: NOW });
      return { ...setting };
    }),
  };
  const printerRepository = {
    findOne: vi.fn(
      async ({ where }: { where: { id: string } }) =>
        printers.find(({ id }) => id === where.id) ?? null,
    ),
  };
  const getRepository = vi.fn((entity: unknown) =>
    entity === CloudPrinterStoreSetting
      ? settingRepository
      : entity === CloudPrinter
        ? printerRepository
        : null,
  );
  const dataSource = {
    getRepository,
    transaction: vi.fn(async (run: (manager: unknown) => Promise<unknown>) =>
      run({ getRepository }),
    ),
  };
  const idempotency = {
    lookup: vi.fn(async () => ({ kind: 'ABSENT' as const })),
    claim: vi.fn(async () => ({
      kind: 'OWNER' as const,
      owner: {
        id: 'operation-1',
        adminId: '7',
        operation: 'CLOUD_PRINTER_CURRENT_SET',
        key: KEY,
        requestHash: 'hash',
      },
    })),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };
  const verification = {
    verifyPassword: vi.fn(async () => ({ status: 'VERIFIED' })),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new CloudPrinterCurrentService(
    dataSource as never,
    verification as never,
    audit as never,
    idempotency as never,
    () => NOW,
  );
  return {
    service,
    manager: { getRepository },
    setting,
    settingRepository,
    printerRepository,
    idempotency,
    verification,
    audit,
  };
};

const apiCode = (code: ApiErrorCode) =>
  expect.objectContaining({ response: expect.objectContaining({ code }) });

describe('CloudPrinterCurrentService', () => {
  it('读取 current 时组装权威 isCurrent，且离线 ACTIVE 仍可设置', async () => {
    const fixture = buildFixture();

    const result = await fixture.service.set(
      ADMIN,
      { printerId: '11', expectedRevision: 1, operationPassword: PASSWORD },
      KEY,
    );

    expect(result.current).toEqual({
      printer: expect.objectContaining({
        id: '11',
        isCurrent: true,
        onlineStatus: CloudPrinterOnlineStatus.OFFLINE,
      }),
      revision: 2,
      updatedAt: NOW.toISOString(),
    });
    expect(fixture.setting).toMatchObject({
      currentPrinterId: '11',
      revision: 2,
      updatedByAdminId: '7',
    });
    expect(fixture.verification.verifyPassword).toHaveBeenCalledWith(
      expect.objectContaining({ candidatePassword: PASSWORD }),
    );
    expect(fixture.idempotency.complete).toHaveBeenCalledTimes(1);
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLOUD_PRINTER_CURRENT_SET' }),
      expect.anything(),
    );
  });

  it('重复设置同一设备自然幂等且不增加 revision', async () => {
    const fixture = buildFixture({ currentPrinterId: '11', revision: 5 });

    const result = await fixture.service.set(
      ADMIN,
      { printerId: '11', expectedRevision: 5, operationPassword: PASSWORD },
      KEY,
    );

    expect(result.current.revision).toBe(5);
    expect(fixture.settingRepository.save).not.toHaveBeenCalled();
  });

  it('stale expectedRevision 返回稳定 409，且不改设置', async () => {
    const fixture = buildFixture({ revision: 3 });

    await expect(
      fixture.service.set(
        ADMIN,
        { printerId: '11', expectedRevision: 2, operationPassword: PASSWORD },
        KEY,
      ),
    ).rejects.toMatchObject(
      apiCode(ApiErrorCode.CLOUD_PRINTER_CURRENT_VERSION_CONFLICT),
    );

    expect(fixture.settingRepository.save).not.toHaveBeenCalled();
    expect(fixture.idempotency.fail).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: CloudPrinterStatus.PENDING_VERIFICATION },
    { status: CloudPrinterStatus.BINDING },
    { status: CloudPrinterStatus.ERROR },
    { status: CloudPrinterStatus.UNBOUND },
    { bindingStage: PrinterBindingStage.RECONCILIATION },
    { vendorRelationState: VendorRelationState.UNKNOWN },
    { unboundAt: NOW },
  ])('拒绝不合格设备 %j', async (override) => {
    const fixture = buildFixture({ printers: [printer(override)] });

    await expect(
      fixture.service.set(
        ADMIN,
        { printerId: '11', expectedRevision: 1, operationPassword: PASSWORD },
        KEY,
      ),
    ).rejects.toMatchObject(
      apiCode(ApiErrorCode.CLOUD_PRINTER_CURRENT_INELIGIBLE),
    );
  });

  it('缺失设备返回 CLOUD_PRINTER_NOT_FOUND', async () => {
    const fixture = buildFixture({ printers: [] });

    await expect(
      fixture.service.set(
        ADMIN,
        { printerId: '99', expectedRevision: 1, operationPassword: PASSWORD },
        KEY,
      ),
    ).rejects.toMatchObject(apiCode(ApiErrorCode.CLOUD_PRINTER_NOT_FOUND));
  });

  it('清空 current 增加 revision；重复清空自然幂等', async () => {
    const fixture = buildFixture({ currentPrinterId: '11', revision: 2 });

    const cleared = await fixture.service.clear(
      ADMIN,
      { expectedRevision: 2, operationPassword: PASSWORD },
      KEY,
    );

    expect(cleared.current).toEqual({
      printer: null,
      revision: 3,
      updatedAt: NOW.toISOString(),
    });
    expect(fixture.setting.currentPrinterId).toBeNull();

    const replayFixture = buildFixture({ currentPrinterId: null, revision: 3 });
    const noChange = await replayFixture.service.clear(
      ADMIN,
      { expectedRevision: 3, operationPassword: PASSWORD },
      KEY,
    );
    expect(noChange.current.revision).toBe(3);
    expect(replayFixture.settingRepository.save).not.toHaveBeenCalled();
  });

  it('解绑检查在目标仍为 current 时返回稳定错误码', async () => {
    const fixture = buildFixture({ currentPrinterId: '11' });

    await expect(
      fixture.service.assertNotCurrentForUnbind(fixture.manager as never, '11'),
    ).rejects.toMatchObject(
      apiCode(ApiErrorCode.CLOUD_PRINTER_CURRENT_UNBIND_FORBIDDEN),
    );
  });

  it('reconciliation helper 仅在目标仍为 current 时清空并写 SYSTEM 审计', async () => {
    const fixture = buildFixture({ currentPrinterId: '11', revision: 8 });

    await expect(
      fixture.service.clearByReconciliation(fixture.manager as never, '11'),
    ).resolves.toBe(true);
    expect(fixture.setting).toMatchObject({
      currentPrinterId: null,
      revision: 9,
      updatedByAdminId: null,
    });
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'SYSTEM' },
        action: 'CLOUD_PRINTER_CURRENT_CLEARED_BY_RECONCILIATION',
      }),
      fixture.manager,
    );
  });
});
