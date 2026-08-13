import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  type ConfirmCloudPrinterCompensationDeletionResult,
  type RequeryCloudPrinterVendorRelationRequest,
  type RequeryCloudPrinterVendorRelationResult,
} from '@bake-mall/contracts';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, In, LessThanOrEqual, type EntityManager } from 'typeorm';

import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AdminVerificationService } from '../auth/admin-verification.service.js';
import { AdminOperationIdempotency } from '../database/entities/admin-operation-idempotency.entity.js';
import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import {
  AdminOperationIdempotencyService,
  type AdminOperationClaim,
  type UnknownIdentityClaim,
} from './admin-operation-idempotency.service.js';
import {
  toSnapshotView,
  type XpyunVendorPort,
} from './cloud-printer.service.js';
import { XPYUN_VENDOR_PORT } from './xpyun/xpyun.types.js';

export const CLOUD_PRINTER_RECONCILIATION_NOW = Symbol(
  'CLOUD_PRINTER_RECONCILIATION_NOW',
);

const VERIFICATION_MAX_ATTEMPTS = 5;
const VERIFICATION_CONTEXT = { purpose: 'HIGH_RISK_ACTION' } as const;
const UNBOUND_VENDOR_CODES = new Set(['1002']);
export const CLOUD_PRINTER_RECONCILIATION_BATCH_LIMIT = 50;
const CLOUD_PRINTER_RECONCILIATION_STALE_AGE_MS = 30_000;
const CLOUD_PRINTER_LOCK_PREFIX = 'bake-mall:cloud-printer:';
const MYSQL_LOCK_NAME_MAX_LENGTH = 64;
const CANONICAL_POSITIVE_DECIMAL_ID = /^[1-9]\d*$/u;

type RecoveryOperation =
  'CLOUD_PRINTER_REQUERY' | 'CLOUD_PRINTER_CONFIRM_DELETION';

type OwnerClaim = Extract<AdminOperationClaim, { kind: 'OWNER' }>;
type RecoveryResult = RequeryCloudPrinterVendorRelationResult;
type StableFailureCode = 'RECOVERY_REQUIRED' | 'RECOVERY_SUPERSEDED';

type SchedulerBatchResult = Readonly<{
  processed: number;
  skipped: number;
  unknown: number;
}>;

type RelationEvidence =
  | Readonly<{
      kind: 'BOUND';
      onlineStatus:
        | CloudPrinterOnlineStatus.ONLINE
        | CloudPrinterOnlineStatus.OFFLINE
        | CloudPrinterOnlineStatus.ABNORMAL;
      vendorCode: string | null;
    }>
  | Readonly<{ kind: 'UNBOUND'; vendorCode: string | null }>
  | Readonly<{ kind: 'UNKNOWN'; vendorCode: string | null }>;

type RecoveryCycle = string | null;

type RequeryIntent = Readonly<{
  claim: OwnerClaim;
  printer: CloudPrinter;
  bindingOperationIdAtClaim: RecoveryCycle;
  queryOnlyDeletion: boolean;
}>;

type UnknownRecoveryIntent = Readonly<{
  identity: UnknownIdentityClaim['identity'];
  printer: CloudPrinter;
  bindingOperationIdAtClaim: RecoveryCycle;
}>;

type Completion<T> =
  | Readonly<{ kind: 'SUCCESS'; result: T }>
  | Readonly<{ kind: 'FAILED'; code: StableFailureCode }>
  | Readonly<{ kind: 'UNKNOWN' }>;

const clearChallenge = (printer: CloudPrinter): void => {
  printer.verificationCodeHash = null;
  printer.verificationExpiresAt = null;
  printer.verificationFailedAttempts = 0;
};

const isKnownOnlineStatus = (
  status: string,
): status is 'ONLINE' | 'OFFLINE' | 'ABNORMAL' =>
  status === 'ONLINE' || status === 'OFFLINE' || status === 'ABNORMAL';

const mapKnownOnlineStatus = (
  status: 'ONLINE' | 'OFFLINE' | 'ABNORMAL',
):
  | CloudPrinterOnlineStatus.ONLINE
  | CloudPrinterOnlineStatus.OFFLINE
  | CloudPrinterOnlineStatus.ABNORMAL => {
  switch (status) {
    case 'ONLINE':
      return CloudPrinterOnlineStatus.ONLINE;
    case 'OFFLINE':
      return CloudPrinterOnlineStatus.OFFLINE;
    case 'ABNORMAL':
      return CloudPrinterOnlineStatus.ABNORMAL;
  }
};

const classifyVendorError = (
  error: unknown,
): Readonly<{
  classification: 'FAILED' | 'UNKNOWN';
  vendorCode: string | null;
}> => {
  if (error && typeof error === 'object') {
    const classification = (error as { classification?: unknown })
      .classification;
    const vendorCode =
      typeof (error as { vendorCode?: unknown }).vendorCode === 'string'
        ? (error as { vendorCode: string }).vendorCode
        : null;
    if (classification === 'FAILED') return { classification, vendorCode };
  }
  return { classification: 'UNKNOWN', vendorCode: null };
};

const operationUnknown = (): HttpException =>
  new HttpException(
    {
      code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
      message: '厂商操作结果未知，必须显式恢复',
    },
    HttpStatus.CONFLICT,
  );

const recoveryRequired = (): ConflictException =>
  new ConflictException({
    code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
    message: '打印机当前状态不允许该恢复操作',
  });

const recoveryCycleFromSnapshot = (
  snapshot: Record<string, unknown> | null,
): RecoveryCycle | undefined => {
  if (!snapshot || !Object.hasOwn(snapshot, 'bindingOperationId')) {
    return undefined;
  }
  const value = snapshot.bindingOperationId;
  return typeof value === 'string' || value === null ? value : undefined;
};

const recoveryUnknownSnapshot = (
  printerId: string,
  bindingOperationId: RecoveryCycle,
) => ({ printerId, bindingOperationId });

const inProgress = (): ConflictException =>
  new ConflictException({
    code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
    message: '打印机恢复正在处理中',
  });

const printerLockUnavailable = (): ServiceUnavailableException =>
  new ServiceUnavailableException('打印机恢复锁释放失败');

const buildPrinterAdvisoryLockName = (printerId: string): string => {
  const lockName = `${CLOUD_PRINTER_LOCK_PREFIX}${printerId}`;
  if (
    !CANONICAL_POSITIVE_DECIMAL_ID.test(printerId) ||
    lockName.length > MYSQL_LOCK_NAME_MAX_LENGTH
  ) {
    throw new BadRequestException('打印机 ID 无效');
  }
  return lockName;
};

@Injectable()
export class CloudPrinterReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly verification: AdminVerificationService,
    private readonly audit: AuditService,
    private readonly idempotencyService: AdminOperationIdempotencyService,
    @Inject(XPYUN_VENDOR_PORT)
    private readonly vendor: XpyunVendorPort,
    @Optional()
    @Inject(CLOUD_PRINTER_RECONCILIATION_NOW)
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcileStaleBatch(): Promise<SchedulerBatchResult> {
    const printers = await this.dataSource.getRepository(CloudPrinter).find({
      where: {
        status: In([CloudPrinterStatus.BINDING, CloudPrinterStatus.ERROR]),
        updatedAt: LessThanOrEqual(
          new Date(
            this.now().getTime() - CLOUD_PRINTER_RECONCILIATION_STALE_AGE_MS,
          ),
        ),
      },
      order: { updatedAt: 'ASC', id: 'ASC' },
      take: CLOUD_PRINTER_RECONCILIATION_BATCH_LIMIT,
    });
    const result = { processed: 0, skipped: 0, unknown: 0 };

    for (const printer of printers) {
      try {
        const outcome = await this.withPrinterAdvisoryLock(
          printer.id,
          async () => {
            const current = await this.dataSource
              .getRepository(CloudPrinter)
              .findOne({ where: { id: printer.id } });
            if (!this.isSameStaleCandidate(printer, current)) return 'SKIPPED';

            const evidence = await this.queryRelation(printer.serialNumber);
            return this.dataSource.transaction((manager) =>
              this.finishScheduledRequery(manager, printer, evidence),
            );
          },
          'SKIP',
        );
        if (outcome === null || outcome === 'SKIPPED') {
          result.skipped += 1;
        } else {
          result.processed += 1;
          if (outcome === 'UNKNOWN') result.unknown += 1;
        }
      } catch {
        result.skipped += 1;
      }
    }

    return result;
  }

  async requery(
    principal: { id: string },
    printerId: string,
    request: RequeryCloudPrinterVendorRelationRequest,
    idempotencyKey: string,
  ): Promise<RequeryCloudPrinterVendorRelationResult> {
    this.assertIdempotencyKey(idempotencyKey);
    const claimRequest = {
      printerId,
      operationPassword: request.operationPassword,
    };
    const preflight =
      await this.preflightOperation<RequeryCloudPrinterVendorRelationResult>(
        principal.id,
        'CLOUD_PRINTER_REQUERY',
        idempotencyKey,
        claimRequest,
        (claim) => this.replay<RequeryCloudPrinterVendorRelationResult>(claim),
        true,
      );
    if (preflight) return preflight;
    await this.verifyPassword(principal.id, request.operationPassword);

    return this.withPrinterAdvisoryLock(printerId, async () => {
      const claimRequest = {
        printerId,
        operationPassword: request.operationPassword,
      };
      const prepared = await this.dataSource.transaction(async (manager) => {
        const claim = await this.idempotencyService.claimOrReconcileUnknown(
          manager,
          {
            adminId: principal.id,
            operation: 'CLOUD_PRINTER_REQUERY' satisfies RecoveryOperation,
            key: idempotencyKey,
            request: claimRequest,
          },
        );
        if (claim.kind === 'REPLAY') {
          return { replay: this.replay<RecoveryResult>(claim) };
        }
        const printer = await manager.getRepository(CloudPrinter).findOne({
          where: { id: printerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (claim.kind === 'UNKNOWN') {
          if (!printer) return { failure: 'RECOVERY_REQUIRED' as const };
          const bindingOperationIdAtClaim = recoveryCycleFromSnapshot(
            claim.responseSnapshot,
          );
          if (
            bindingOperationIdAtClaim === undefined ||
            (printer.bindingOperationId ?? null) !== bindingOperationIdAtClaim
          ) {
            await this.supersedeUnknownRecovery(
              manager,
              { type: 'ADMIN', adminUserId: principal.id },
              claim.identity,
              printer,
              request.operationPassword,
            );
            return { failure: 'RECOVERY_SUPERSEDED' as const };
          }
          return {
            unknown: {
              identity: claim.identity,
              printer,
              bindingOperationIdAtClaim,
            } satisfies UnknownRecoveryIntent,
          };
        }
        if (!printer) {
          await this.idempotencyService.fail(manager, {
            owner: claim.owner,
            responseSnapshot: { code: 'RECOVERY_REQUIRED' },
            sensitiveValues: [request.operationPassword],
          });
          return { failure: 'RECOVERY_REQUIRED' as const };
        }
        if (!this.canRequery(printer)) {
          await this.idempotencyService.fail(manager, {
            owner: claim.owner,
            resourceType: 'CLOUD_PRINTER',
            resourceId: printer.id,
            responseSnapshot: {
              printerId: printer.id,
              code: 'RECOVERY_REQUIRED',
            },
            sensitiveValues: [printer.serialNumber, request.operationPassword],
          });
          return { failure: 'RECOVERY_REQUIRED' as const };
        }
        return {
          intent: {
            claim,
            printer,
            bindingOperationIdAtClaim: printer.bindingOperationId ?? null,
            queryOnlyDeletion: false,
          } satisfies RequeryIntent,
        };
      });
      if ('replay' in prepared && prepared.replay) return prepared.replay;
      if ('failure' in prepared && prepared.failure) {
        throw this.failureException(prepared.failure);
      }

      const unknownIntent =
        'unknown' in prepared ? prepared.unknown : undefined;
      const intent = 'intent' in prepared ? prepared.intent : undefined;
      if (!unknownIntent && !intent)
        throw this.failureException('RECOVERY_REQUIRED');
      const printer = unknownIntent ? unknownIntent.printer : intent!.printer;
      const evidence = await this.queryRelation(printer.serialNumber);
      if (unknownIntent) {
        const completion = await this.dataSource.transaction((manager) =>
          this.finishUnknownRequery(
            manager,
            { type: 'ADMIN', adminUserId: principal.id },
            unknownIntent,
            evidence,
            request.operationPassword,
          ),
        );
        return this.unwrap(completion);
      }
      const completion = await this.dataSource.transaction((manager) =>
        this.finishRequery(
          manager,
          { type: 'ADMIN', adminUserId: principal.id },
          intent!,
          evidence,
          request.operationPassword,
        ),
      );
      return this.unwrap(completion);
    });
  }

  async confirmDeletion(
    principal: { id: string },
    printerId: string,
    request: RequeryCloudPrinterVendorRelationRequest,
    idempotencyKey: string,
  ): Promise<ConfirmCloudPrinterCompensationDeletionResult> {
    this.assertIdempotencyKey(idempotencyKey);
    const claimRequest = {
      printerId,
      operationPassword: request.operationPassword,
    };
    const preflight =
      await this.preflightOperation<ConfirmCloudPrinterCompensationDeletionResult>(
        principal.id,
        'CLOUD_PRINTER_CONFIRM_DELETION',
        idempotencyKey,
        claimRequest,
        (claim) =>
          this.replay<ConfirmCloudPrinterCompensationDeletionResult>(claim),
        true,
      );
    if (preflight) return preflight;
    await this.verifyPassword(principal.id, request.operationPassword);

    return this.withPrinterAdvisoryLock(printerId, async () => {
      const claimRequest = {
        printerId,
        operationPassword: request.operationPassword,
      };
      const prepared = await this.dataSource.transaction(async (manager) => {
        const claim = await this.idempotencyService.claimOrReconcileUnknown(
          manager,
          {
            adminId: principal.id,
            operation:
              'CLOUD_PRINTER_CONFIRM_DELETION' satisfies RecoveryOperation,
            key: idempotencyKey,
            request: claimRequest,
          },
        );
        if (claim.kind === 'REPLAY') {
          return {
            replay:
              this.replay<ConfirmCloudPrinterCompensationDeletionResult>(claim),
          };
        }
        const printer = await manager.getRepository(CloudPrinter).findOne({
          where: { id: printerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (claim.kind === 'UNKNOWN') {
          if (!printer) return { failure: 'RECOVERY_REQUIRED' as const };
          const bindingOperationIdAtClaim = recoveryCycleFromSnapshot(
            claim.responseSnapshot,
          );
          if (
            bindingOperationIdAtClaim === undefined ||
            (printer.bindingOperationId ?? null) !== bindingOperationIdAtClaim
          ) {
            await this.supersedeUnknownRecovery(
              manager,
              { type: 'ADMIN', adminUserId: principal.id },
              claim.identity,
              printer,
              request.operationPassword,
            );
            return { failure: 'RECOVERY_SUPERSEDED' as const };
          }
          return {
            unknown: {
              identity: claim.identity,
              printer,
              bindingOperationIdAtClaim,
            } satisfies UnknownRecoveryIntent,
          };
        }
        if (!printer) {
          await this.idempotencyService.fail(manager, {
            owner: claim.owner,
            responseSnapshot: { code: 'RECOVERY_REQUIRED' },
            sensitiveValues: [request.operationPassword],
          });
          return { failure: 'RECOVERY_REQUIRED' as const };
        }
        if (!this.canConfirmDeletion(printer)) {
          await this.idempotencyService.fail(manager, {
            owner: claim.owner,
            resourceType: 'CLOUD_PRINTER',
            resourceId: printer.id,
            responseSnapshot: {
              printerId: printer.id,
              code: 'RECOVERY_REQUIRED',
            },
            sensitiveValues: [printer.serialNumber, request.operationPassword],
          });
          return { failure: 'RECOVERY_REQUIRED' as const };
        }
        return {
          intent: {
            claim,
            printer,
            bindingOperationIdAtClaim: printer.bindingOperationId ?? null,
            queryOnlyDeletion:
              printer.bindingStage === PrinterBindingStage.UNBIND_DELETE,
          } satisfies RequeryIntent,
        };
      });
      if ('replay' in prepared && prepared.replay) return prepared.replay;
      if ('failure' in prepared && prepared.failure) {
        throw this.failureException(prepared.failure);
      }
      const unknownIntent =
        'unknown' in prepared ? prepared.unknown : undefined;
      const intent = 'intent' in prepared ? prepared.intent : undefined;
      if (unknownIntent) {
        const evidence = await this.queryRelation(
          unknownIntent.printer.serialNumber,
        );
        const completion = await this.dataSource.transaction((manager) =>
          this.finishUnknownDeletion(
            manager,
            principal.id,
            unknownIntent,
            evidence,
            request.operationPassword,
          ),
        );
        return this.unwrap(completion);
      }

      if (!intent) throw this.failureException('RECOVERY_REQUIRED');
      if (intent.queryOnlyDeletion) {
        const evidence = await this.queryRelation(intent.printer.serialNumber);
        const completion = await this.dataSource.transaction((manager) =>
          this.finishQueriedUnbindDeletion(
            manager,
            principal.id,
            intent,
            evidence,
            request.operationPassword,
          ),
        );
        return this.unwrap(completion);
      }
      let deletion:
        | Readonly<{ kind: 'ACCEPTED'; vendorCode: string | null }>
        | Readonly<{
            kind: 'FAILED' | 'UNKNOWN';
            vendorCode: string | null;
          }>;
      try {
        const result = await this.vendor.deletePrinter(
          intent.printer.serialNumber,
        );
        deletion = { kind: 'ACCEPTED', vendorCode: result.vendorCode };
      } catch (error) {
        const classified = classifyVendorError(error);
        deletion = {
          kind: classified.classification,
          vendorCode: classified.vendorCode,
        };
      }

      const completion = await this.dataSource.transaction((manager) =>
        this.finishDeletion(
          manager,
          principal.id,
          intent,
          deletion,
          request.operationPassword,
        ),
      );
      return this.unwrap(completion);
    });
  }

  private isSameStaleCandidate(
    selected: CloudPrinter,
    current: CloudPrinter | null,
  ): current is CloudPrinter {
    return Boolean(
      current &&
      current.version === selected.version &&
      this.canRequery(current) &&
      current.updatedAt.getTime() <=
        this.now().getTime() - CLOUD_PRINTER_RECONCILIATION_STALE_AGE_MS,
    );
  }

  private async finishScheduledRequery(
    manager: EntityManager,
    intent: CloudPrinter,
    evidence: RelationEvidence,
  ): Promise<RelationEvidence['kind'] | 'SKIPPED'> {
    const repository = manager.getRepository(CloudPrinter);
    const printer = await repository.findOne({
      where: { id: intent.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !printer ||
      printer.version !== intent.version ||
      !this.canRequery(printer)
    ) {
      return 'SKIPPED';
    }

    this.applyRelationEvidence(printer, evidence);
    const saved = await repository.save(printer);
    await this.reconcileOriginalUnknownOperations(manager, saved, evidence);
    await this.recordAudit(
      manager,
      { type: 'SYSTEM' },
      saved.id,
      'CLOUD_PRINTER_REQUERIED',
      { result: evidence.kind, status: saved.status },
    );
    return evidence.kind;
  }

  private async supersedeUnknownRecovery(
    manager: EntityManager,
    actor: AuditActor,
    identity: UnknownIdentityClaim['identity'],
    printer: CloudPrinter,
    operationPassword: string,
  ): Promise<void> {
    await this.idempotencyService.reconcileUnknownByIdentity(manager, {
      identity,
      sensitiveValues: [printer.serialNumber, operationPassword],
      reconcile: async () => ({
        status: 'FAILED',
        resourceType: 'CLOUD_PRINTER',
        resourceId: printer.id,
        responseSnapshot: {
          printerId: printer.id,
          code: 'RECOVERY_SUPERSEDED',
        },
      }),
    });
    await this.recordAudit(
      manager,
      actor,
      printer.id,
      'CLOUD_PRINTER_RECOVERY_SUPERSEDED',
      { result: 'RECOVERY_SUPERSEDED', status: printer.status },
    );
  }

  private async supersedeOwnedRecovery(
    manager: EntityManager,
    actor: AuditActor,
    intent: RequeryIntent,
    printer: CloudPrinter,
    operationPassword: string,
  ): Promise<Completion<never>> {
    await this.idempotencyService.fail(manager, {
      owner: intent.claim.owner,
      resourceType: 'CLOUD_PRINTER',
      resourceId: printer.id,
      responseSnapshot: {
        printerId: printer.id,
        code: 'RECOVERY_SUPERSEDED',
      },
      sensitiveValues: [printer.serialNumber, operationPassword],
    });
    await this.recordAudit(
      manager,
      actor,
      printer.id,
      'CLOUD_PRINTER_RECOVERY_SUPERSEDED',
      { result: 'RECOVERY_SUPERSEDED', status: printer.status },
    );
    return { kind: 'FAILED', code: 'RECOVERY_SUPERSEDED' };
  }

  private async finishUnknownRequery(
    manager: EntityManager,
    actor: AuditActor,
    intent: UnknownRecoveryIntent,
    evidence: RelationEvidence,
    operationPassword: string,
  ): Promise<Completion<RecoveryResult>> {
    const repository = manager.getRepository(CloudPrinter);
    const printer = await repository.findOne({
      where: { id: intent.printer.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!printer) return { kind: 'UNKNOWN' };
    if (
      (printer.bindingOperationId ?? null) !== intent.bindingOperationIdAtClaim
    ) {
      await this.supersedeUnknownRecovery(
        manager,
        actor,
        intent.identity,
        printer,
        operationPassword,
      );
      return { kind: 'FAILED', code: 'RECOVERY_SUPERSEDED' };
    }
    this.applyRelationEvidence(printer, evidence);
    const saved = await repository.save(printer);
    const outcome =
      evidence.kind === 'UNKNOWN'
        ? {
            status: 'UNKNOWN' as const,
            resourceType: 'CLOUD_PRINTER',
            resourceId: saved.id,
            responseSnapshot: recoveryUnknownSnapshot(
              saved.id,
              intent.bindingOperationIdAtClaim,
            ),
          }
        : {
            status: 'COMPLETED' as const,
            resourceType: 'CLOUD_PRINTER',
            resourceId: saved.id,
            responseSnapshot: { printer: toSnapshotView(saved) },
          };
    const reconciled = await this.idempotencyService.reconcileUnknownByIdentity(
      manager,
      {
        identity: intent.identity,
        sensitiveValues: [saved.serialNumber, operationPassword],
        reconcile: async () => outcome,
      },
    );
    await this.recordAudit(
      manager,
      actor,
      saved.id,
      'CLOUD_PRINTER_REQUERIED',
      {
        result: evidence.kind,
        status: saved.status,
      },
    );
    if (reconciled.kind !== 'REPLAY') return { kind: 'UNKNOWN' };
    return reconciled.status === 'COMPLETED'
      ? {
          kind: 'SUCCESS',
          result: reconciled.responseSnapshot as RecoveryResult,
        }
      : { kind: 'FAILED', code: 'RECOVERY_REQUIRED' };
  }

  private async finishRequery(
    manager: EntityManager,
    actor: AuditActor,
    intent: RequeryIntent,
    evidence: RelationEvidence,
    operationPassword: string,
  ): Promise<Completion<RecoveryResult>> {
    const repository = manager.getRepository(CloudPrinter);
    const printer = await repository.findOne({
      where: { id: intent.printer.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!printer) {
      await this.idempotencyService.markUnknown(manager, {
        owner: intent.claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: intent.printer.id,
        responseSnapshot: recoveryUnknownSnapshot(
          intent.printer.id,
          intent.bindingOperationIdAtClaim,
        ),
        sensitiveValues: [intent.printer.serialNumber, operationPassword],
      });
      return { kind: 'UNKNOWN' };
    }
    if (
      (printer.bindingOperationId ?? null) !== intent.bindingOperationIdAtClaim
    ) {
      return this.supersedeOwnedRecovery(
        manager,
        actor,
        intent,
        printer,
        operationPassword,
      );
    }

    this.applyRelationEvidence(printer, evidence);
    const saved = await repository.save(printer);
    await this.reconcileOriginalUnknownOperations(manager, saved, evidence);

    if (evidence.kind === 'UNKNOWN') {
      await this.idempotencyService.markUnknown(manager, {
        owner: intent.claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: saved.id,
        responseSnapshot: recoveryUnknownSnapshot(
          saved.id,
          intent.bindingOperationIdAtClaim,
        ),
        sensitiveValues: [saved.serialNumber, operationPassword],
      });
      await this.recordAudit(
        manager,
        actor,
        saved.id,
        'CLOUD_PRINTER_REQUERIED',
        {
          result: 'UNKNOWN',
          status: saved.status,
        },
      );
      return { kind: 'UNKNOWN' };
    }

    const result = { printer: toSnapshotView(saved) };
    await this.idempotencyService.complete(manager, {
      owner: intent.claim.owner,
      resourceType: 'CLOUD_PRINTER',
      resourceId: saved.id,
      responseSnapshot: result,
      sensitiveValues: [saved.serialNumber, operationPassword],
    });
    await this.recordAudit(
      manager,
      actor,
      saved.id,
      'CLOUD_PRINTER_REQUERIED',
      {
        result: 'COMPLETED',
        status: saved.status,
        onlineStatus: saved.lastOnlineStatus,
      },
    );
    return { kind: 'SUCCESS', result };
  }

  private async finishUnknownDeletion(
    manager: EntityManager,
    adminId: string,
    intent: UnknownRecoveryIntent,
    evidence: RelationEvidence,
    operationPassword: string,
  ): Promise<Completion<ConfirmCloudPrinterCompensationDeletionResult>> {
    const repository = manager.getRepository(CloudPrinter);
    const printer = await repository.findOne({
      where: { id: intent.printer.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!printer) return { kind: 'UNKNOWN' };
    if (
      (printer.bindingOperationId ?? null) !== intent.bindingOperationIdAtClaim
    ) {
      await this.supersedeUnknownRecovery(
        manager,
        { type: 'ADMIN', adminUserId: adminId },
        intent.identity,
        printer,
        operationPassword,
      );
      return { kind: 'FAILED', code: 'RECOVERY_SUPERSEDED' };
    }
    if (evidence.kind === 'UNBOUND') {
      printer.status = CloudPrinterStatus.UNBOUND;
      printer.bindingStage = PrinterBindingStage.NONE;
      printer.vendorRelationState = VendorRelationState.CONFIRMED_UNBOUND;
      printer.unboundAt = this.now();
      printer.lastOnlineStatus = CloudPrinterOnlineStatus.UNKNOWN;
      clearChallenge(printer);
    } else if (evidence.kind === 'BOUND') {
      printer.status = CloudPrinterStatus.ERROR;
      printer.bindingStage = PrinterBindingStage.COMPENSATION_DELETE;
      printer.vendorRelationState = VendorRelationState.CONFIRMED_BOUND;
    } else {
      printer.status = CloudPrinterStatus.ERROR;
      printer.bindingStage = PrinterBindingStage.COMPENSATION_DELETE;
      printer.vendorRelationState = VendorRelationState.UNKNOWN;
    }
    const saved = await repository.save(printer);
    const outcome =
      evidence.kind === 'UNBOUND'
        ? {
            status: 'COMPLETED' as const,
            resourceType: 'CLOUD_PRINTER',
            resourceId: saved.id,
            responseSnapshot: { printer: toSnapshotView(saved) },
          }
        : evidence.kind === 'BOUND'
          ? {
              status: 'FAILED' as const,
              resourceType: 'CLOUD_PRINTER',
              resourceId: saved.id,
              responseSnapshot: {
                printerId: saved.id,
                code: 'RECOVERY_REQUIRED',
              },
            }
          : {
              status: 'UNKNOWN' as const,
              resourceType: 'CLOUD_PRINTER',
              resourceId: saved.id,
              responseSnapshot: recoveryUnknownSnapshot(
                saved.id,
                intent.bindingOperationIdAtClaim,
              ),
            };
    const reconciled = await this.idempotencyService.reconcileUnknownByIdentity(
      manager,
      {
        identity: intent.identity,
        sensitiveValues: [saved.serialNumber, operationPassword],
        reconcile: async () => outcome,
      },
    );
    await this.recordAudit(
      manager,
      { type: 'ADMIN', adminUserId: adminId },
      saved.id,
      'CLOUD_PRINTER_COMPENSATION_DELETE_CONFIRMED',
      {
        result: evidence.kind,
        status: saved.status,
      },
    );
    if (reconciled.kind !== 'REPLAY') return { kind: 'UNKNOWN' };
    return reconciled.status === 'COMPLETED'
      ? {
          kind: 'SUCCESS',
          result:
            reconciled.responseSnapshot as ConfirmCloudPrinterCompensationDeletionResult,
        }
      : { kind: 'FAILED', code: 'RECOVERY_REQUIRED' };
  }

  private async finishQueriedUnbindDeletion(
    manager: EntityManager,
    adminId: string,
    intent: RequeryIntent,
    evidence: RelationEvidence,
    operationPassword: string,
  ): Promise<Completion<ConfirmCloudPrinterCompensationDeletionResult>> {
    const repository = manager.getRepository(CloudPrinter);
    const printer = await repository.findOne({
      where: { id: intent.printer.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!printer) return { kind: 'UNKNOWN' };
    if (
      (printer.bindingOperationId ?? null) !== intent.bindingOperationIdAtClaim ||
      printer.bindingStage !== PrinterBindingStage.UNBIND_DELETE
    ) {
      return this.supersedeOwnedRecovery(
        manager,
        { type: 'ADMIN', adminUserId: adminId },
        intent,
        printer,
        operationPassword,
      );
    }

    printer.lastStatusCheckedAt = this.now();
    printer.lastVendorErrorCode = evidence.vendorCode;
    if (evidence.kind === 'UNBOUND') {
      printer.status = CloudPrinterStatus.UNBOUND;
      printer.bindingStage = PrinterBindingStage.NONE;
      printer.vendorRelationState = VendorRelationState.CONFIRMED_UNBOUND;
      printer.unboundAt = this.now();
      printer.lastOnlineStatus = CloudPrinterOnlineStatus.UNKNOWN;
      clearChallenge(printer);
    } else if (evidence.kind === 'BOUND') {
      printer.status = CloudPrinterStatus.ACTIVE;
      printer.bindingStage = PrinterBindingStage.NONE;
      printer.vendorRelationState = VendorRelationState.CONFIRMED_BOUND;
      printer.unboundAt = null;
      printer.lastOnlineStatus = evidence.onlineStatus;
      printer.lastVendorErrorCode = null;
    } else {
      printer.status = CloudPrinterStatus.ERROR;
      printer.vendorRelationState = VendorRelationState.UNKNOWN;
    }
    const saved = await repository.save(printer);
    const result = { printer: toSnapshotView(saved) };
    if (evidence.kind === 'UNKNOWN') {
      await this.idempotencyService.markUnknown(manager, {
        owner: intent.claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: saved.id,
        responseSnapshot: recoveryUnknownSnapshot(
          saved.id,
          intent.bindingOperationIdAtClaim,
        ),
        sensitiveValues: [saved.serialNumber, operationPassword],
      });
      return { kind: 'UNKNOWN' };
    }
    await this.idempotencyService.complete(manager, {
      owner: intent.claim.owner,
      resourceType: 'CLOUD_PRINTER',
      resourceId: saved.id,
      responseSnapshot: result,
      sensitiveValues: [saved.serialNumber, operationPassword],
    });
    await this.recordAudit(
      manager,
      { type: 'ADMIN', adminUserId: adminId },
      saved.id,
      'CLOUD_PRINTER_UNBIND_DELETION_QUERIED',
      { result: evidence.kind, status: saved.status },
    );
    return { kind: 'SUCCESS', result };
  }

  private async finishDeletion(
    manager: EntityManager,
    adminId: string,
    intent: RequeryIntent,
    deletion: Readonly<{
      kind: 'ACCEPTED' | 'FAILED' | 'UNKNOWN';
      vendorCode: string | null;
    }>,
    operationPassword: string,
  ): Promise<Completion<ConfirmCloudPrinterCompensationDeletionResult>> {
    const repository = manager.getRepository(CloudPrinter);
    const printer = await repository.findOne({
      where: { id: intent.printer.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!printer) {
      await this.idempotencyService.markUnknown(manager, {
        owner: intent.claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: intent.printer.id,
        responseSnapshot: recoveryUnknownSnapshot(
          intent.printer.id,
          intent.bindingOperationIdAtClaim,
        ),
        sensitiveValues: [intent.printer.serialNumber, operationPassword],
      });
      return { kind: 'UNKNOWN' };
    }
    if (
      (printer.bindingOperationId ?? null) !== intent.bindingOperationIdAtClaim
    ) {
      return this.supersedeOwnedRecovery(
        manager,
        { type: 'ADMIN', adminUserId: adminId },
        intent,
        printer,
        operationPassword,
      );
    }

    printer.lastVendorErrorCode = deletion.vendorCode;
    if (deletion.kind === 'ACCEPTED') {
      printer.status = CloudPrinterStatus.UNBOUND;
      printer.bindingStage = PrinterBindingStage.NONE;
      printer.vendorRelationState = VendorRelationState.CONFIRMED_UNBOUND;
      printer.unboundAt = this.now();
      printer.lastOnlineStatus = CloudPrinterOnlineStatus.UNKNOWN;
      printer.lastStatusCheckedAt = this.now();
      printer.lastVendorErrorCode = null;
      clearChallenge(printer);
    } else {
      printer.status = CloudPrinterStatus.ERROR;
      printer.vendorRelationState = VendorRelationState.UNKNOWN;
    }
    const saved = await repository.save(printer);

    if (deletion.kind === 'UNKNOWN') {
      await this.idempotencyService.markUnknown(manager, {
        owner: intent.claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: saved.id,
        responseSnapshot: recoveryUnknownSnapshot(
          saved.id,
          intent.bindingOperationIdAtClaim,
        ),
        sensitiveValues: [saved.serialNumber, operationPassword],
      });
      await this.recordAudit(
        manager,
        { type: 'ADMIN', adminUserId: adminId },
        saved.id,
        'CLOUD_PRINTER_COMPENSATION_DELETE_CONFIRMED',
        { result: 'UNKNOWN', status: saved.status },
      );
      return { kind: 'UNKNOWN' };
    }

    if (deletion.kind === 'FAILED') {
      await this.idempotencyService.fail(manager, {
        owner: intent.claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: saved.id,
        responseSnapshot: { printerId: saved.id, code: 'RECOVERY_REQUIRED' },
        sensitiveValues: [saved.serialNumber, operationPassword],
      });
      await this.recordAudit(
        manager,
        { type: 'ADMIN', adminUserId: adminId },
        saved.id,
        'CLOUD_PRINTER_COMPENSATION_DELETE_CONFIRMED',
        { result: 'FAILED', status: saved.status },
      );
      return { kind: 'FAILED', code: 'RECOVERY_REQUIRED' };
    }

    await this.reconcileOriginalUnknownOperations(manager, saved, {
      kind: 'UNBOUND',
      vendorCode: deletion.vendorCode,
    });
    const result = { printer: toSnapshotView(saved) };
    await this.idempotencyService.complete(manager, {
      owner: intent.claim.owner,
      resourceType: 'CLOUD_PRINTER',
      resourceId: saved.id,
      responseSnapshot: result,
      sensitiveValues: [saved.serialNumber, operationPassword],
    });
    await this.recordAudit(
      manager,
      { type: 'ADMIN', adminUserId: adminId },
      saved.id,
      'CLOUD_PRINTER_COMPENSATION_DELETE_CONFIRMED',
      { result: 'COMPLETED', status: saved.status },
    );
    return { kind: 'SUCCESS', result };
  }

  private applyRelationEvidence(
    printer: CloudPrinter,
    evidence: RelationEvidence,
  ): void {
    printer.lastStatusCheckedAt = this.now();
    printer.lastVendorErrorCode = evidence.vendorCode;
    if (evidence.kind === 'UNBOUND') {
      printer.status = CloudPrinterStatus.UNBOUND;
      printer.bindingStage = PrinterBindingStage.NONE;
      printer.vendorRelationState = VendorRelationState.CONFIRMED_UNBOUND;
      printer.lastOnlineStatus = CloudPrinterOnlineStatus.UNKNOWN;
      printer.unboundAt = this.now();
      clearChallenge(printer);
      return;
    }
    if (evidence.kind === 'UNKNOWN') {
      printer.status = CloudPrinterStatus.ERROR;
      printer.bindingStage = PrinterBindingStage.RECONCILIATION;
      printer.vendorRelationState = VendorRelationState.UNKNOWN;
      printer.lastOnlineStatus = CloudPrinterOnlineStatus.UNKNOWN;
      printer.unboundAt = null;
      return;
    }

    printer.vendorRelationState = VendorRelationState.CONFIRMED_BOUND;
    printer.lastOnlineStatus = evidence.onlineStatus;
    printer.lastVendorErrorCode = null;
    printer.unboundAt = null;
    if (printer.bindingStage === PrinterBindingStage.COMPENSATION_DELETE) {
      printer.status = CloudPrinterStatus.ERROR;
    } else {
      clearChallenge(printer);
      printer.status = CloudPrinterStatus.ERROR;
      printer.bindingStage = PrinterBindingStage.RECONCILIATION;
    }
  }

  private async reconcileOriginalUnknownOperations(
    manager: EntityManager,
    printer: CloudPrinter,
    evidence: RelationEvidence,
  ): Promise<void> {
    if (!printer.bindingOperationId) return;
    const record = await manager
      .getRepository(AdminOperationIdempotency)
      .findOne({
        where: {
          id: printer.bindingOperationId,
          ...(printer.bindingIdempotencyKey
            ? { key: printer.bindingIdempotencyKey }
            : {}),
          operation: In(['CLOUD_PRINTER_BIND', 'CLOUD_PRINTER_RESEND']),
          resourceType: 'CLOUD_PRINTER',
          resourceId: printer.id,
          status: 'UNKNOWN',
        },
      });
    if (!record) return;
    await this.idempotencyService.reconcileUnknownByIdentity(manager, {
      identity: {
        id: record.id,
        adminId: record.adminId,
        operation: record.operation,
        key: record.key,
        requestHash: record.requestHash,
      },
      sensitiveValues: [printer.serialNumber],
      reconcile: async () =>
        this.originalOutcome(record.operation, printer, evidence),
    });
  }

  private originalOutcome(
    operation: string,
    printer: CloudPrinter,
    evidence: RelationEvidence,
  ) {
    if (evidence.kind === 'UNKNOWN') {
      return {
        status: 'UNKNOWN' as const,
        resourceType: 'CLOUD_PRINTER',
        resourceId: printer.id,
        responseSnapshot: null,
      };
    }
    if (evidence.kind === 'UNBOUND') {
      return {
        status: 'FAILED' as const,
        resourceType: 'CLOUD_PRINTER',
        resourceId: printer.id,
        responseSnapshot: { printerId: printer.id, code: 'RECOVERY_REQUIRED' },
      };
    }
    if (!this.hasUsableChallenge(printer)) {
      return {
        status: 'FAILED' as const,
        resourceType: 'CLOUD_PRINTER',
        resourceId: printer.id,
        responseSnapshot: { printerId: printer.id, code: 'RECOVERY_REQUIRED' },
      };
    }
    const responseSnapshot = {
      printer: toSnapshotView(printer),
      challenge: {
        challengeId: printer.id,
        expiresAt: printer.verificationExpiresAt!.toISOString(),
        remainingAttempts: Math.max(
          0,
          VERIFICATION_MAX_ATTEMPTS - printer.verificationFailedAttempts,
        ),
      },
    };
    return {
      status: 'COMPLETED' as const,
      resourceType: 'CLOUD_PRINTER',
      resourceId: printer.id,
      responseSnapshot,
    };
  }

  private async queryRelation(serialNumber: string): Promise<RelationEvidence> {
    try {
      const result = await this.vendor.queryOnline(serialNumber);
      return isKnownOnlineStatus(result.status)
        ? {
            kind: 'BOUND',
            onlineStatus: mapKnownOnlineStatus(result.status),
            vendorCode: result.vendorCode,
          }
        : { kind: 'UNKNOWN', vendorCode: result.vendorCode };
    } catch (error) {
      const classified = classifyVendorError(error);
      return classified.classification === 'FAILED' &&
        classified.vendorCode !== null &&
        UNBOUND_VENDOR_CODES.has(classified.vendorCode)
        ? { kind: 'UNBOUND', vendorCode: classified.vendorCode }
        : { kind: 'UNKNOWN', vendorCode: classified.vendorCode };
    }
  }

  private canRequery(printer: CloudPrinter): boolean {
    return (
      (printer.status === CloudPrinterStatus.BINDING ||
        printer.status === CloudPrinterStatus.ERROR) &&
      printer.bindingStage !== PrinterBindingStage.UNBIND_DELETE
    );
  }

  private canConfirmDeletion(printer: CloudPrinter): boolean {
    return (
      printer.status === CloudPrinterStatus.ERROR &&
      (printer.bindingStage === PrinterBindingStage.COMPENSATION_DELETE ||
        printer.bindingStage === PrinterBindingStage.UNBIND_DELETE)
    );
  }

  private hasUsableChallenge(printer: CloudPrinter): boolean {
    return Boolean(
      printer.verificationCodeHash &&
      printer.verificationExpiresAt &&
      printer.verificationExpiresAt.getTime() > this.now().getTime() &&
      printer.verificationFailedAttempts < VERIFICATION_MAX_ATTEMPTS,
    );
  }

  private async verifyPassword(adminId: string, candidatePassword: string) {
    if (!candidatePassword) {
      throw new BadRequestException({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
        message: 'operationPassword is required',
      });
    }
    return this.verification.verifyPassword({
      adminId,
      candidatePassword,
      now: this.now(),
      context: VERIFICATION_CONTEXT,
    });
  }

  private async preflightOperation<T>(
    adminId: string,
    operation: RecoveryOperation,
    key: string,
    request: unknown,
    replay: (claim: Extract<AdminOperationClaim, { kind: 'REPLAY' }>) => T,
    allowUnknown = false,
  ): Promise<T | null> {
    const lookup = await this.idempotencyService.lookup(
      {
        getRepository: (entity) => this.dataSource.getRepository(entity),
      },
      {
        adminId,
        operation,
        key,
        request,
      },
    );
    if (lookup.kind === 'ABSENT') return null;
    if (lookup.kind === 'CONTINUE') {
      if (lookup.status === 'IN_PROGRESS' || allowUnknown) return null;
      throw new ConflictException({
        code:
          lookup.status === 'UNKNOWN'
            ? ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN
            : ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
        message:
          lookup.status === 'UNKNOWN'
            ? '操作结果未知，必须显式恢复后再继续'
            : '相同管理员操作正在处理中',
      });
    }
    return replay(lookup);
  }

  private assertIdempotencyKey(key: string): void {
    if (!key) {
      throw new BadRequestException({
        code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
        message: 'Idempotency-Key header is required',
      });
    }
  }

  private replay<T>(
    claim: Extract<AdminOperationClaim, { kind: 'REPLAY' }>,
  ): T {
    if (claim.status === 'COMPLETED') return claim.responseSnapshot as T;
    const code = claim.responseSnapshot?.code;
    throw this.failureException(
      code === 'RECOVERY_SUPERSEDED'
        ? 'RECOVERY_SUPERSEDED'
        : 'RECOVERY_REQUIRED',
    );
  }

  private failureException(code: StableFailureCode): HttpException {
    switch (code) {
      case 'RECOVERY_REQUIRED':
      case 'RECOVERY_SUPERSEDED':
        return recoveryRequired();
    }
  }

  private unwrap<T>(completion: Completion<T>): T {
    if (completion.kind === 'SUCCESS') return completion.result;
    if (completion.kind === 'UNKNOWN') throw operationUnknown();
    throw this.failureException(completion.code);
  }

  private withPrinterAdvisoryLock<T>(
    printerId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
  private withPrinterAdvisoryLock<T>(
    printerId: string,
    operation: () => Promise<T>,
    unavailable: 'SKIP',
  ): Promise<T | null>;
  private async withPrinterAdvisoryLock<T>(
    printerId: string,
    operation: () => Promise<T>,
    unavailable: 'THROW' | 'SKIP' = 'THROW',
  ): Promise<T | null> {
    const lockName = buildPrinterAdvisoryLockName(printerId);
    const runner = this.dataSource.createQueryRunner();
    let acquired = false;
    let skipped = false;
    let operationResult: T;
    let primaryError: unknown;
    let hasPrimaryError = false;
    let releaseError: unknown;

    try {
      await runner.connect();
      const rows = (await runner.query('SELECT GET_LOCK(?, 0) AS acquired', [
        lockName,
      ])) as Array<{ acquired: number | string }>;
      acquired = Number(rows[0]?.acquired) === 1;
      if (!acquired) {
        if (unavailable === 'SKIP') skipped = true;
        else {
          primaryError = inProgress();
          hasPrimaryError = true;
        }
      } else {
        try {
          operationResult = await operation();
        } catch (error) {
          primaryError = error;
          hasPrimaryError = true;
        }
      }
    } catch (error) {
      primaryError = error;
      hasPrimaryError = true;
    } finally {
      try {
        if (acquired) {
          try {
            await runner.query('SELECT RELEASE_LOCK(?) AS released', [
              lockName,
            ]);
          } catch (error) {
            releaseError = error;
          }
        }
      } finally {
        try {
          await runner.release();
        } catch (error) {
          releaseError ??= error;
        }
      }
    }

    if (hasPrimaryError) throw primaryError;
    if (releaseError) throw printerLockUnavailable();
    if (skipped) return null;
    return operationResult!;
  }

  private async recordAudit(
    manager: EntityManager,
    actor: AuditActor,
    printerId: string,
    action: string,
    changeSummary: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.audit.record(
      {
        actor,
        targetEntity: 'cloud_printers',
        targetId: printerId,
        action,
        changeSummary: { printerId, ...changeSummary },
      },
      manager,
    );
  }
}
