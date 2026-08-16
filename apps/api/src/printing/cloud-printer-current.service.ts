import {
  ApiErrorCode,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  type ClearCurrentCloudPrinterRequest,
  type ClearCurrentCloudPrinterResult,
  type CurrentCloudPrinterView,
  type SetCurrentCloudPrinterRequest,
  type SetCurrentCloudPrinterResult,
} from '@bake-mall/contracts';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { type AuthenticatedAdmin } from '../auth/auth.types.js';
import { AdminVerificationService } from '../auth/admin-verification.service.js';
import {
  CLOUD_PRINTER_STORE_SCOPE,
  CloudPrinterStoreSetting,
} from '../database/entities/cloud-printer-store-setting.entity.js';
import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import {
  AdminOperationIdempotencyService,
  type AdminOperationClaim,
} from './admin-operation-idempotency.service.js';
import { toView } from './cloud-printer-view.js';

export const CLOUD_PRINTER_CURRENT_NOW = Symbol('CLOUD_PRINTER_CURRENT_NOW');

const VERIFICATION_CONTEXT = { purpose: 'HIGH_RISK_ACTION' } as const;
type CurrentOperation =
  'CLOUD_PRINTER_CURRENT_SET' | 'CLOUD_PRINTER_CURRENT_CLEAR';
type ReplayClaim = Extract<AdminOperationClaim, { kind: 'REPLAY' }>;

type CurrentFailure = 'NOT_FOUND' | 'INELIGIBLE' | 'VERSION_CONFLICT';

type CurrentWriteOutcome<T> =
  | Readonly<{ replay: T }>
  | Readonly<{ failure: CurrentFailure }>
  | Readonly<{ result: T }>;

function currentException(
  failure: CurrentFailure,
): NotFoundException | ConflictException {
  switch (failure) {
    case 'NOT_FOUND':
      return new NotFoundException({
        code: ApiErrorCode.CLOUD_PRINTER_NOT_FOUND,
        message: '打印机不存在',
      });
    case 'INELIGIBLE':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_CURRENT_INELIGIBLE,
        message: '打印机当前状态不允许设为当前设备',
      });
    case 'VERSION_CONFLICT':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_CURRENT_VERSION_CONFLICT,
        message: '当前打印机设置已被其他操作更新',
      });
  }
}

function isEligibleCurrentPrinter(printer: CloudPrinter): boolean {
  return (
    printer.status === CloudPrinterStatus.ACTIVE &&
    printer.bindingStage === PrinterBindingStage.NONE &&
    printer.vendorRelationState === VendorRelationState.CONFIRMED_BOUND &&
    printer.unboundAt === null
  );
}

@Injectable()
export class CloudPrinterCurrentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly verification: AdminVerificationService,
    private readonly audit: AuditService,
    private readonly idempotency: AdminOperationIdempotencyService,
    @Optional()
    @Inject(CLOUD_PRINTER_CURRENT_NOW)
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(): Promise<CurrentCloudPrinterView> {
    const setting = await this.settingRepository().findOne({
      where: { scopeKey: CLOUD_PRINTER_STORE_SCOPE },
    });
    if (!setting) {
      throw new Error('current cloud printer STORE setting missing');
    }
    const printer = await this.findCurrentPrinter(
      this.dataSource.manager,
      setting,
    );
    return this.currentView(setting, printer);
  }

  async set(
    principal: AuthenticatedAdmin,
    request: SetCurrentCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<SetCurrentCloudPrinterResult> {
    this.assertWriteInput(request.operationPassword, idempotencyKey);
    const claimRequest = { ...request };
    const replay = await this.preflight<SetCurrentCloudPrinterResult>(
      principal.id,
      'CLOUD_PRINTER_CURRENT_SET',
      idempotencyKey,
      claimRequest,
    );
    if (replay) return replay;
    await this.verifyPassword(principal.id, request.operationPassword);

    const outcome: CurrentWriteOutcome<SetCurrentCloudPrinterResult> =
      await this.dataSource.transaction(async (manager) => {
        const claim = await this.idempotency.claim(manager, {
          adminId: principal.id,
          operation: 'CLOUD_PRINTER_CURRENT_SET' satisfies CurrentOperation,
          key: idempotencyKey,
          request: claimRequest,
        });
        if (claim.kind === 'REPLAY')
          return { replay: this.replay<SetCurrentCloudPrinterResult>(claim) };
        const setting = await this.lockSetting(manager);
        if (setting.revision !== request.expectedRevision) {
          await this.fail(manager, claim, 'VERSION_CONFLICT', setting.id, [
            request.operationPassword,
          ]);
          return { failure: 'VERSION_CONFLICT' as const };
        }
        const printer = await manager.getRepository(CloudPrinter).findOne({
          where: { id: request.printerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!printer) {
          await this.fail(manager, claim, 'NOT_FOUND', setting.id, [
            request.operationPassword,
          ]);
          return { failure: 'NOT_FOUND' as const };
        }
        if (!isEligibleCurrentPrinter(printer)) {
          await this.fail(manager, claim, 'INELIGIBLE', printer.id, [
            printer.serialNumber,
            request.operationPassword,
          ]);
          return { failure: 'INELIGIBLE' as const };
        }
        const saved =
          setting.currentPrinterId === printer.id
            ? setting
            : await manager.getRepository(CloudPrinterStoreSetting).save({
                ...setting,
                currentPrinterId: printer.id,
                revision: setting.revision + 1,
                updatedByAdminId: principal.id,
                updatedAt: this.now(),
              });
        const result: SetCurrentCloudPrinterResult = {
          current: this.currentView(saved, printer),
        };
        await this.idempotency.complete(manager, {
          owner: claim.owner,
          resourceType: 'CLOUD_PRINTER_STORE_SETTING',
          resourceId: saved.id,
          responseSnapshot: result,
          sensitiveValues: [printer.serialNumber, request.operationPassword],
        });
        if (setting.currentPrinterId !== printer.id) {
          await this.audit.record(
            {
              actor: { type: 'ADMIN', adminUserId: principal.id },
              targetEntity: 'cloud_printer_store_settings',
              targetId: saved.id,
              action: 'CLOUD_PRINTER_CURRENT_SET',
              changeSummary: {
                printerId: printer.id,
                revision: saved.revision,
                result: 'COMPLETED',
              },
            },
            manager,
          );
        }
        return { result };
      });
    return this.resolveWriteOutcome(outcome);
  }

  async clear(
    principal: AuthenticatedAdmin,
    request: ClearCurrentCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<ClearCurrentCloudPrinterResult> {
    this.assertWriteInput(request.operationPassword, idempotencyKey);
    const claimRequest = { ...request };
    const replay = await this.preflight<ClearCurrentCloudPrinterResult>(
      principal.id,
      'CLOUD_PRINTER_CURRENT_CLEAR',
      idempotencyKey,
      claimRequest,
    );
    if (replay) return replay;
    await this.verifyPassword(principal.id, request.operationPassword);

    const outcome: CurrentWriteOutcome<ClearCurrentCloudPrinterResult> =
      await this.dataSource.transaction(async (manager) => {
        const claim = await this.idempotency.claim(manager, {
          adminId: principal.id,
          operation: 'CLOUD_PRINTER_CURRENT_CLEAR' satisfies CurrentOperation,
          key: idempotencyKey,
          request: claimRequest,
        });
        if (claim.kind === 'REPLAY')
          return { replay: this.replay<ClearCurrentCloudPrinterResult>(claim) };
        const setting = await this.lockSetting(manager);
        if (setting.revision !== request.expectedRevision) {
          await this.fail(manager, claim, 'VERSION_CONFLICT', setting.id, [
            request.operationPassword,
          ]);
          return { failure: 'VERSION_CONFLICT' as const };
        }
        const previousPrinterId = setting.currentPrinterId;
        const saved =
          previousPrinterId === null
            ? setting
            : await manager.getRepository(CloudPrinterStoreSetting).save({
                ...setting,
                currentPrinterId: null,
                revision: setting.revision + 1,
                updatedByAdminId: principal.id,
                updatedAt: this.now(),
              });
        const result: ClearCurrentCloudPrinterResult = {
          current: this.currentView(saved, null),
        };
        await this.idempotency.complete(manager, {
          owner: claim.owner,
          resourceType: 'CLOUD_PRINTER_STORE_SETTING',
          resourceId: saved.id,
          responseSnapshot: result,
          sensitiveValues: [request.operationPassword],
        });
        if (previousPrinterId !== null) {
          await this.audit.record(
            {
              actor: { type: 'ADMIN', adminUserId: principal.id },
              targetEntity: 'cloud_printer_store_settings',
              targetId: saved.id,
              action: 'CLOUD_PRINTER_CURRENT_CLEARED',
              changeSummary: {
                printerId: previousPrinterId,
                revision: saved.revision,
                result: 'COMPLETED',
              },
            },
            manager,
          );
        }
        return { result };
      });
    return this.resolveWriteOutcome(outcome);
  }

  async assertNotCurrentForUnbind(
    manager: EntityManager,
    printerId: string,
  ): Promise<void> {
    const setting = await this.lockSetting(manager);
    if (setting.currentPrinterId === printerId) {
      throw new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_CURRENT_UNBIND_FORBIDDEN,
        message: '当前打印机必须先切换或清除后才能解绑',
      });
    }
  }

  async clearByReconciliation(
    manager: EntityManager,
    printerId: string,
  ): Promise<boolean> {
    const setting = await this.lockSetting(manager);
    if (setting.currentPrinterId !== printerId) return false;
    const saved = await manager.getRepository(CloudPrinterStoreSetting).save({
      ...setting,
      currentPrinterId: null,
      revision: setting.revision + 1,
      updatedByAdminId: null,
      updatedAt: this.now(),
    });
    await this.audit.record(
      {
        actor: { type: 'SYSTEM' },
        targetEntity: 'cloud_printer_store_settings',
        targetId: saved.id,
        action: 'CLOUD_PRINTER_CURRENT_CLEARED_BY_RECONCILIATION',
        changeSummary: {
          printerId,
          revision: saved.revision,
          result: 'COMPLETED',
        },
      },
      manager,
    );
    return true;
  }

  private async findCurrentPrinter(
    manager: Pick<EntityManager, 'getRepository'>,
    setting: CloudPrinterStoreSetting,
  ): Promise<CloudPrinter | null> {
    if (!setting.currentPrinterId) return null;
    return manager.getRepository(CloudPrinter).findOne({
      where: { id: setting.currentPrinterId },
    });
  }

  private currentView(
    setting: CloudPrinterStoreSetting,
    printer: CloudPrinter | null,
  ): CurrentCloudPrinterView {
    return {
      printer: printer ? toView(printer, true) : null,
      revision: setting.revision,
      updatedAt: setting.updatedAt.toISOString(),
    };
  }

  private resolveWriteOutcome<T>(outcome: CurrentWriteOutcome<T>): T {
    if ('replay' in outcome) return outcome.replay;
    if ('failure' in outcome) throw currentException(outcome.failure);
    return outcome.result;
  }

  private async lockSetting(
    manager: EntityManager,
  ): Promise<CloudPrinterStoreSetting> {
    const setting = await manager
      .getRepository(CloudPrinterStoreSetting)
      .findOne({
        where: { scopeKey: CLOUD_PRINTER_STORE_SCOPE },
        lock: { mode: 'pessimistic_write' },
      });
    if (!setting) {
      throw new Error('current cloud printer STORE setting missing');
    }
    return setting;
  }

  private async preflight<T>(
    adminId: string,
    operation: CurrentOperation,
    key: string,
    request: unknown,
  ): Promise<T | null> {
    const lookup = await this.idempotency.lookup(
      { getRepository: (entity) => this.dataSource.getRepository(entity) },
      { adminId, operation, key, request },
    );
    if (lookup.kind === 'ABSENT') return null;
    if (lookup.kind === 'CONTINUE') {
      throw new ConflictException({
        code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
        message: '当前打印机操作正在处理中',
      });
    }
    return this.replay<T>(lookup);
  }

  private replay<T>(claim: ReplayClaim): T {
    if (claim.status === 'COMPLETED') return claim.responseSnapshot as T;
    const code = claim.responseSnapshot?.code;
    if (code === 'NOT_FOUND' || code === 'INELIGIBLE') {
      throw currentException(code);
    }
    throw currentException('VERSION_CONFLICT');
  }

  private async fail(
    manager: EntityManager,
    claim: Extract<AdminOperationClaim, { kind: 'OWNER' }>,
    failure: CurrentFailure,
    resourceId: string,
    sensitiveValues: readonly string[],
  ): Promise<void> {
    await this.idempotency.fail(manager, {
      owner: claim.owner,
      resourceType: 'CLOUD_PRINTER_STORE_SETTING',
      resourceId,
      responseSnapshot: { code: failure },
      sensitiveValues,
    });
  }

  private assertWriteInput(operationPassword: string, key: string): void {
    if (!key) {
      throw new BadRequestException({
        code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
        message: 'Idempotency-Key header is required',
      });
    }
    if (!operationPassword) {
      throw new BadRequestException({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
        message: 'operationPassword is required',
      });
    }
  }

  private verifyPassword(adminId: string, candidatePassword: string) {
    return this.verification.verifyPassword({
      adminId,
      candidatePassword,
      now: this.now(),
      context: VERIFICATION_CONTEXT,
    });
  }

  private settingRepository() {
    return this.dataSource.getRepository(CloudPrinterStoreSetting);
  }
}
