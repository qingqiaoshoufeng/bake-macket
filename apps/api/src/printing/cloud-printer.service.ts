import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrintBatchStatus,
  PrintJobStatus,
  PrinterBindingStage,
  VendorRelationState,
  displayNameContainsSensitiveSerial,
  normalizeCloudPrinterDisplayName,
  normalizeCloudPrinterSerialNumber,
  type BindCloudPrinterRequest,
  type BindCloudPrinterResult,
  type CloudPrinterListQuery,
  type CloudPrinterListResult,
  type CloudPrinterView,
  type ConfirmCloudPrinterRequest,
  type ConfirmCloudPrinterResult,
  type RefreshCloudPrinterOnlineStatusResult,
  type RenameCloudPrinterRequest,
  type RenameCloudPrinterResult,
  type ResendCloudPrinterVerificationRequest,
  type ResendCloudPrinterVerificationResult,
  type UnbindCloudPrinterRequest,
  type UnbindCloudPrinterResult,
} from '@bake-mall/contracts';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  DataSource,
  In,
  IsNull,
  Not,
  type EntityManager,
  type Repository,
} from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { type AuthenticatedAdmin } from '../auth/auth.types.js';
import { AdminVerificationService } from '../auth/admin-verification.service.js';
import { AdminOperationIdempotency } from '../database/entities/admin-operation-idempotency.entity.js';
import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import { PrintBatch } from '../database/entities/print-batch.entity.js';
import { PrintJob } from '../database/entities/print-job.entity.js';
import {
  AdminOperationIdempotencyService,
  type AdminOperationClaim,
  type FenceStaleInProgressResult,
  type OperationIdentity,
} from './admin-operation-idempotency.service.js';
import { CloudPrinterCurrentService } from './cloud-printer-current.service.js';
import {
  normalizeCloudPrinterSnapshot,
  projectCloudPrinterResult,
  toSnapshotView,
  toView,
} from './cloud-printer-view.js';
import { XPYUN_VENDOR_PORT } from './xpyun/xpyun.types.js';
import type {
  XpyunAddPrinterResult,
  XpyunDeletePrinterResult,
  XpyunOnlineResult,
  XpyunPrinterInput,
  XpyunPrintResult,
  XpyunReceiptInput,
  XpyunVendorFailureClassification,
} from './xpyun/xpyun.types.js';

export type XpyunVendorPort = Readonly<{
  addPrinter: (input: XpyunPrinterInput) => Promise<XpyunAddPrinterResult>;
  deletePrinter: (serialNumber: string) => Promise<XpyunDeletePrinterResult>;
  print: (input: XpyunReceiptInput) => Promise<XpyunPrintResult>;
  queryOnline: (serialNumber: string) => Promise<XpyunOnlineResult>;
}>;

export const CLOUD_PRINTER_NOW = Symbol('CLOUD_PRINTER_NOW');
export const CLOUD_PRINTER_OPTIONS = Symbol('CLOUD_PRINTER_OPTIONS');

type CloudPrinterOptions = Readonly<{
  verificationWindowMs?: number;
  verificationMaxAttempts?: number;
  onlineStatusCacheMs?: number;
  verificationCodeBcryptCost?: number;
}>;

type OperationName =
  | 'CLOUD_PRINTER_BIND'
  | 'CLOUD_PRINTER_CONFIRM'
  | 'CLOUD_PRINTER_RESEND'
  | 'CLOUD_PRINTER_RENAME'
  | 'CLOUD_PRINTER_REFRESH_ONLINE'
  | 'PRINT_DEVICE_UNBIND';

type OwnerClaim = Extract<AdminOperationClaim, { kind: 'OWNER' }>;
type ReplayClaim = Extract<AdminOperationClaim, { kind: 'REPLAY' }>;
type FailureCode =
  | 'SERIAL_INVALID'
  | 'VENDOR_REJECTED'
  | 'VENDOR_LIMIT'
  | 'VENDOR_RATE_LIMITED'
  | 'VENDOR_UNAVAILABLE'
  | 'OWNERSHIP_CONFLICT'
  | 'RECOVERY_REQUIRED'
  | 'CODE_INVALID'
  | 'ATTEMPTS_EXHAUSTED'
  | 'EXPIRED'
  | 'INVALID_STATE'
  | 'ONLINE_STATUS_UNKNOWN'
  | 'NOT_FOUND'
  | 'UNBIND_BLOCKED'
  | 'IDEMPOTENCY_RESULT_UNKNOWN';

type StableFailureSnapshot = Readonly<{
  code: FailureCode;
  printerId?: string;
}>;

type StableOperationOutcome<T> =
  Readonly<{ snapshot: T }> | Readonly<{ failure: FailureCode }>;

type RefreshCycle = Readonly<{
  bindingOperationId: string | null;
  version: number;
}>;

type RefreshPrepared =
  | Readonly<{
      kind: 'SNAPSHOT';
      snapshot: RefreshCloudPrinterOnlineStatusResult;
    }>
  | Readonly<{ kind: 'FAILURE'; failure: FailureCode }>
  | Readonly<{
      kind: 'INTENT';
      claim: OwnerClaim;
      printer: CloudPrinter;
      cycle: RefreshCycle;
    }>
  | Readonly<{
      kind: 'RECONCILE';
      identity: OperationIdentity;
      printer: CloudPrinter;
      cycle: RefreshCycle;
    }>;

type RefreshOutcome =
  | Readonly<{
      kind: 'SNAPSHOT';
      snapshot: RefreshCloudPrinterOnlineStatusResult;
    }>
  | Readonly<{ kind: 'FAILURE'; failure: FailureCode }>
  | Readonly<{ kind: 'UNKNOWN' }>;

type RefreshVendorResult = Readonly<{
  onlineStatus: CloudPrinterOnlineStatus;
  vendorCode: string | null;
}>;

type BindIntent = Readonly<{
  claim: OwnerClaim;
  printer: CloudPrinter;
  priorOwnershipProven: boolean;
}>;

type ChallengeIntent = Readonly<{
  claim: OwnerClaim;
  printer: CloudPrinter;
}>;

type VendorClassification =
  | Readonly<{ kind: 'SUCCESS'; vendorCode: string | null }>
  | Readonly<{ kind: 'FAILED'; vendorCode: string | null }>
  | Readonly<{ kind: 'RATE_LIMITED'; vendorCode: string | null }>
  | Readonly<{ kind: 'UNAVAILABLE'; vendorCode: string | null }>
  | Readonly<{ kind: 'UNKNOWN'; vendorCode: string | null }>;

const vendorFailureClassification = (
  classification: unknown,
): classification is XpyunVendorFailureClassification =>
  classification === 'FAILED' ||
  classification === 'RATE_LIMITED' ||
  classification === 'UNAVAILABLE' ||
  classification === 'UNKNOWN';

type RelationEvidence = 'CONFIRMED_BOUND' | 'CONFIRMED_UNBOUND' | 'UNKNOWN';

const VERIFICATION_WINDOW_MS = 5 * 60 * 1000;
const VERIFICATION_MAX_ATTEMPTS = 5;
const ONLINE_STATUS_CACHE_MS = 30 * 1000;
const VERIFICATION_CODE_BCRYPT_COST = 10;
const ALREADY_EXISTS_VENDOR_CODES = new Set(['1011']);
const OWNERSHIP_CONFLICT_VENDOR_CODES = new Set(['1001', '1022']);
const NOT_REGISTERED_VENDOR_CODES = new Set(['1002']);
const VERIFICATION_OPERATION_CONTEXT = { purpose: 'HIGH_RISK_ACTION' } as const;

const invalidPrinterName = (): BadRequestException =>
  new BadRequestException({
    code: ApiErrorCode.CLOUD_PRINTER_NAME_INVALID,
    message: 'displayName must not contain the full serial number',
  });

const generateVerificationCode = (): string => {
  const limit = 2 ** 32 - (2 ** 32 % 1_000_000);
  let value: number;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return (value % 1_000_000).toString().padStart(6, '0');
};

const challengeTradeOrderId = (printerId: string): string => {
  const compactId = /^\d+$/u.test(printerId)
    ? BigInt(printerId).toString(36)
    : createHash('sha256').update(printerId).digest('hex').slice(0, 12);
  return `cp-${compactId}-${randomUUID().replaceAll('-', '')}`;
};

const errorClassification = (error: unknown): VendorClassification => {
  if (error && typeof error === 'object') {
    const classification = (error as { classification?: unknown })
      .classification;
    const vendorCode =
      typeof (error as { vendorCode?: unknown }).vendorCode === 'string'
        ? (error as { vendorCode: string }).vendorCode
        : null;
    if (vendorFailureClassification(classification)) {
      return { kind: classification, vendorCode };
    }
  }
  return { kind: 'UNKNOWN', vendorCode: null };
};

const printClassification = (
  result: XpyunPrintResult,
): VendorClassification => {
  if (result.classification === 'ACCEPTED') {
    return { kind: 'SUCCESS', vendorCode: result.vendorCode };
  }
  return {
    kind: result.classification,
    vendorCode: result.vendorCode,
  };
};

const apiCodeOf = (error: unknown): unknown =>
  error && typeof error === 'object' && 'response' in error
    ? (error as { response?: { code?: unknown } }).response?.code
    : undefined;

const failedException = (code: FailureCode): HttpException => {
  switch (code) {
    case 'SERIAL_INVALID':
      return new BadRequestException({
        code: ApiErrorCode.CLOUD_PRINTER_SERIAL_INVALID,
        message: '打印机设备号无效',
      });
    case 'VENDOR_LIMIT':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_VENDOR_LIMIT,
        message: '芯烨云账号关联打印机数量已达上限',
      });
    case 'VENDOR_RATE_LIMITED':
      return new HttpException(
        {
          code: ApiErrorCode.CLOUD_PRINTER_VENDOR_RATE_LIMITED,
          message: '芯烨云请求过于频繁，请稍后重试',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    case 'VENDOR_UNAVAILABLE':
      return new ServiceUnavailableException({
        code: ApiErrorCode.CLOUD_PRINTER_VENDOR_UNAVAILABLE,
        message: '芯烨云服务暂时不可用，请稍后重试',
      });
    case 'OWNERSHIP_CONFLICT':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_OWNERSHIP_CONFLICT,
        message: '打印机已存在，但本地无法证明该云账号的既往归属',
      });
    case 'RECOVERY_REQUIRED':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
        message: '操作已终止，必须使用新的操作恢复设备',
      });
    case 'CODE_INVALID':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
        message: '验证码错误',
      });
    case 'ATTEMPTS_EXHAUSTED':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_ATTEMPTS_EXHAUSTED,
        message: '验证码尝试次数已用尽',
      });
    case 'EXPIRED':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_EXPIRED,
        message: '验证码已过期',
      });
    case 'INVALID_STATE':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
        message: '验证码已不可用',
      });
    case 'ONLINE_STATUS_UNKNOWN':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_ONLINE_STATUS_UNKNOWN,
        message: '无法确认打印机在线状态',
      });
    case 'NOT_FOUND':
      return new NotFoundException({
        code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
        message: 'printer not found',
      });
    case 'UNBIND_BLOCKED':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_UNBIND_BLOCKED,
        message: '打印机仍被非终态打印批次或任务引用',
      });
    case 'IDEMPOTENCY_RESULT_UNKNOWN':
      return resultUnknown('当前绑定周期结果未知，必须先收敛原操作');
    case 'VENDOR_REJECTED':
      return new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_VENDOR_REJECTED,
        message: '芯烨云拒绝该操作',
      });
  }
};

const mapPrintVendorFailure = (
  result: Exclude<VendorClassification, { kind: 'SUCCESS' | 'UNKNOWN' }>,
): FailureCode => {
  if (result.kind === 'RATE_LIMITED') return 'VENDOR_RATE_LIMITED';
  if (result.kind === 'UNAVAILABLE') return 'VENDOR_UNAVAILABLE';
  return 'VENDOR_REJECTED';
};

export const mapAddVendorFailure = (
  result: Exclude<VendorClassification, { kind: 'SUCCESS' | 'UNKNOWN' }>,
): FailureCode => {
  if (result.kind === 'RATE_LIMITED') return 'VENDOR_RATE_LIMITED';
  if (result.kind === 'UNAVAILABLE') return 'VENDOR_UNAVAILABLE';

  switch (result.vendorCode) {
    case '1010':
      return 'SERIAL_INVALID';
    case '1001':
    case '1022':
      return 'OWNERSHIP_CONFLICT';
    case '1033':
      return 'VENDOR_LIMIT';
    default:
      return 'VENDOR_REJECTED';
  }
};

const resultUnknown = (message: string): HttpException =>
  new HttpException(
    { code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN, message },
    HttpStatus.CONFLICT,
  );

const persistenceUnavailable = (cause: unknown): HttpException =>
  new ServiceUnavailableException(
    {
      code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
      message: '打印机操作正在处理中，请稍后重试',
    },
    { cause },
  );

const clearChallenge = (printer: CloudPrinter): void => {
  printer.verificationCodeHash = null;
  printer.verificationExpiresAt = null;
  printer.verificationFailedAttempts = 0;
};

const verifyStoredCode = async (
  candidate: string,
  stored: string | null,
): Promise<boolean> => (stored ? bcrypt.compare(candidate, stored) : false);

@Injectable()
export class CloudPrinterService {
  private readonly verificationWindowMs: number;
  private readonly verificationMaxAttempts: number;
  private readonly onlineStatusCacheMs: number;
  private readonly verificationCodeBcryptCost: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly verification: AdminVerificationService,
    private readonly audit: AuditService,
    private readonly idempotencyService: AdminOperationIdempotencyService,
    @Inject(XPYUN_VENDOR_PORT)
    private readonly vendor: XpyunVendorPort,
    @Optional()
    @Inject(CLOUD_PRINTER_NOW)
    private readonly now: () => Date = () => new Date(),
    @Optional()
    @Inject(CLOUD_PRINTER_OPTIONS)
    options: CloudPrinterOptions = {},
    @Optional()
    private readonly currentPrinters?: CloudPrinterCurrentService,
  ) {
    this.verificationWindowMs =
      options.verificationWindowMs ?? VERIFICATION_WINDOW_MS;
    this.verificationMaxAttempts =
      options.verificationMaxAttempts ?? VERIFICATION_MAX_ATTEMPTS;
    this.onlineStatusCacheMs =
      options.onlineStatusCacheMs ?? ONLINE_STATUS_CACHE_MS;
    this.verificationCodeBcryptCost =
      options.verificationCodeBcryptCost ?? VERIFICATION_CODE_BCRYPT_COST;
  }

  async bind(
    principal: AuthenticatedAdmin,
    request: BindCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<BindCloudPrinterResult> {
    const normalized = this.normalizeBindInput(request);
    if (
      displayNameContainsSensitiveSerial(
        normalized.displayName,
        normalized.serialNumber,
      )
    ) {
      throw invalidPrinterName();
    }
    this.assertIdempotencyKey(idempotencyKey);

    const claimRequest = {
      serialNumber: normalized.serialNumber,
      displayName: normalized.displayName,
      operationPassword: normalized.operationPassword,
    };
    const operation: OperationName = 'CLOUD_PRINTER_BIND';
    const preflight = await this.preflightOperation<BindCloudPrinterResult>(
      principal,
      operation,
      idempotencyKey,
      claimRequest,
      (claim) => this.handleReplay<BindCloudPrinterResult>(claim),
    );
    if (preflight) return this.projectResult(preflight);
    await this.verifyPassword(principal, normalized.operationPassword);
    let intent: BindIntent | StableOperationOutcome<BindCloudPrinterResult>;
    try {
      intent = await this.withDeadlockRetry(() =>
        this.dataSource.transaction((manager) =>
          this.claimBindIntent(
            manager,
            principal,
            normalized,
            idempotencyKey,
            claimRequest,
          ),
        ),
      );
    } catch (error) {
      if (this.isRecoverableIdempotencyError(error)) {
        return this.projectResult(
          await this.reconcileUnknownOperation<BindCloudPrinterResult>({
            principal,
            operation,
            key: idempotencyKey,
            request: claimRequest,
            fallbackPrinterId: null,
            fallbackSerialNumber: normalized.serialNumber,
            sensitiveValues: [
              normalized.serialNumber,
              normalized.operationPassword,
            ],
          }),
        );
      }
      throw error;
    }
    if ('snapshot' in intent) return this.projectResult(intent.snapshot);
    if ('failure' in intent) throw failedException(intent.failure);

    let add: VendorClassification;
    try {
      const result = await this.vendor.addPrinter({
        serialNumber: normalized.serialNumber,
        displayName: normalized.displayName,
      });
      add = { kind: 'SUCCESS', vendorCode: result.vendorCode };
    } catch (error) {
      add = errorClassification(error);
    }

    if (add.kind !== 'SUCCESS') {
      const alreadyExists =
        add.kind === 'FAILED' &&
        add.vendorCode !== null &&
        ALREADY_EXISTS_VENDOR_CODES.has(add.vendorCode);
      if (alreadyExists && intent.priorOwnershipProven) {
        const ownership = await this.queryAlreadyExistingOwnership(
          normalized.serialNumber,
        );
        if (ownership.kind === 'SUCCESS') {
          add = ownership;
        } else {
          const failureCode: FailureCode =
            ownership.kind === 'FAILED'
              ? 'OWNERSHIP_CONFLICT'
              : 'RECOVERY_REQUIRED';
          await this.finishAddFailure(
            principal,
            intent,
            ownership,
            failureCode,
            normalized,
          );
          if (ownership.kind === 'UNKNOWN') {
            throw resultUnknown('打印机归属查询结果未知，必须先收敛原操作');
          }
          throw failedException(failureCode);
        }
      } else {
        const failureCode: FailureCode = alreadyExists
          ? 'OWNERSHIP_CONFLICT'
          : add.kind === 'FAILED' ||
              add.kind === 'RATE_LIMITED' ||
              add.kind === 'UNAVAILABLE'
            ? mapAddVendorFailure(add)
            : 'RECOVERY_REQUIRED';
        await this.finishAddFailure(
          principal,
          intent,
          add,
          failureCode,
          normalized,
        );
        if (add.kind === 'UNKNOWN') {
          throw resultUnknown('绑定结果未知，必须先收敛原操作');
        }
        throw failedException(failureCode);
      }
    }

    const code = generateVerificationCode();
    const codeHash = await bcrypt.hash(code, this.verificationCodeBcryptCost);
    let challenge: ChallengeIntent;
    try {
      challenge = await this.dataSource.transaction((manager) =>
        this.saveChallenge(manager, intent, codeHash),
      );
    } catch {
      try {
        await this.fallbackUnknown(
          principal,
          intent.claim,
          intent.printer.id,
          PrinterBindingStage.RECONCILIATION,
          'CLOUD_PRINTER_BIND_FAILED',
        );
      } catch (fallbackError) {
        throw persistenceUnavailable(fallbackError);
      }
      throw resultUnknown('厂商已接受绑定，但本地验证码提交中断');
    }

    let print: VendorClassification;
    try {
      print = printClassification(
        await this.vendor.print({
          serialNumber: challenge.printer.serialNumber,
          content: `ownership-code:${code}`,
          tradeOrderId: challengeTradeOrderId(challenge.printer.id),
        }),
      );
    } catch (error) {
      print = errorClassification(error);
    }

    if (print.kind !== 'SUCCESS') {
      if (print.kind === 'UNKNOWN') {
        await this.finishBindPrintUnknown(principal, challenge, print);
        throw resultUnknown('验证码打印结果未知，必须先收敛原操作');
      }

      let deletion: VendorClassification;
      try {
        const deleted = await this.vendor.deletePrinter(
          challenge.printer.serialNumber,
        );
        deletion = { kind: 'SUCCESS', vendorCode: deleted.vendorCode };
      } catch (error) {
        deletion = errorClassification(error);
      }
      await this.finishBindPrintFailure(
        principal,
        challenge,
        print,
        deletion,
        normalized,
        code,
      );
      if (deletion.kind === 'UNKNOWN') {
        throw resultUnknown('验证码打印补偿结果未知，必须先收敛原操作');
      }
      throw failedException(
        deletion.kind === 'SUCCESS'
          ? mapPrintVendorFailure(print)
          : 'RECOVERY_REQUIRED',
      );
    }

    let snapshot: BindCloudPrinterResult;
    try {
      snapshot = await this.dataSource.transaction((manager) =>
        this.completeChallenge(
          manager,
          principal,
          challenge,
          normalized.operationPassword,
          code,
          'CLOUD_PRINTER_BIND_INITIATED',
        ),
      );
    } catch {
      try {
        await this.fallbackUnknown(
          principal,
          challenge.claim,
          challenge.printer.id,
          PrinterBindingStage.RECONCILIATION,
          'CLOUD_PRINTER_BIND_FAILED',
        );
      } catch (fallbackError) {
        throw persistenceUnavailable(fallbackError);
      }
      throw resultUnknown('厂商已接受验证码打印，但本地完成提交中断');
    }
    return this.projectResult(snapshot);
  }

  async confirm(
    principal: AuthenticatedAdmin,
    request: ConfirmCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<ConfirmCloudPrinterResult> {
    const normalized = this.normalizeConfirmInput(request);
    this.assertIdempotencyKey(idempotencyKey);
    const claimRequest = { ...normalized };
    const preflight =
      await this.preflightConfirmOperation<ConfirmCloudPrinterResult>(
        principal,
        idempotencyKey,
        claimRequest,
        (claim) => this.handleReplay<ConfirmCloudPrinterResult>(claim),
      );
    if (preflight) return this.projectResult(preflight);
    await this.verifyPassword(principal, normalized.operationPassword);

    const prepared = await this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotencyService.claim(manager, {
        adminId: principal.id,
        operation: 'CLOUD_PRINTER_CONFIRM' satisfies OperationName,
        key: idempotencyKey,
        request: claimRequest,
      });
      if (claim.kind === 'REPLAY') {
        return { replay: this.handleReplay<ConfirmCloudPrinterResult>(claim) };
      }
      const printer = await manager.getRepository(CloudPrinter).findOne({
        where: { id: normalized.challengeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!printer) {
        await this.idempotencyService.fail(manager, {
          owner: claim.owner,
          responseSnapshot: { code: 'INVALID_STATE' },
          sensitiveValues: [normalized.operationPassword, normalized.code],
        });
        return { failure: 'INVALID_STATE' as const };
      }
      return {
        claim,
        printerId: printer.id,
        serialNumber: printer.serialNumber,
        version: printer.version,
        status: printer.status,
        verificationCodeHash: printer.verificationCodeHash,
        verificationExpiresAt: printer.verificationExpiresAt,
        verificationFailedAttempts: printer.verificationFailedAttempts,
      };
    });
    if ('replay' in prepared && prepared.replay) {
      return this.projectResult(prepared.replay);
    }
    if ('failure' in prepared && prepared.failure) {
      throw failedException(prepared.failure);
    }

    let matches: boolean;
    try {
      matches = await verifyStoredCode(
        normalized.code,
        prepared.verificationCodeHash,
      );
    } catch {
      return this.failConfirmUnknown(prepared.claim, prepared.printerId);
    }

    let outcome: StableOperationOutcome<ConfirmCloudPrinterResult>;
    try {
      outcome = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(CloudPrinter);
        const printer = await repository.findOne({
          where: { id: prepared.printerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !printer ||
          printer.version !== prepared.version ||
          printer.verificationCodeHash !== prepared.verificationCodeHash
        ) {
          await this.idempotencyService.fail(manager, {
            owner: prepared.claim.owner,
            resourceType: 'CLOUD_PRINTER',
            resourceId: prepared.printerId,
            responseSnapshot: {
              printerId: prepared.printerId,
              code: 'INVALID_STATE',
            },
            sensitiveValues: [
              prepared.serialNumber,
              normalized.operationPassword,
              normalized.code,
            ],
          });
          return { failure: 'INVALID_STATE' as const };
        }

        let failure = this.confirmFailure(printer, matches);
        if (failure) {
          if (failure === 'CODE_INVALID') {
            printer.verificationFailedAttempts += 1;
            if (
              printer.verificationFailedAttempts >= this.verificationMaxAttempts
            ) {
              printer.status = CloudPrinterStatus.ERROR;
              printer.bindingStage =
                PrinterBindingStage.PRINT_VERIFICATION_CODE;
              failure = 'ATTEMPTS_EXHAUSTED';
            }
            await repository.save(printer);
          }
          await this.idempotencyService.fail(manager, {
            owner: prepared.claim.owner,
            resourceType: 'CLOUD_PRINTER',
            resourceId: printer.id,
            responseSnapshot: { printerId: printer.id, code: failure },
            sensitiveValues: [
              printer.serialNumber,
              normalized.operationPassword,
              normalized.code,
            ],
          });
          await this.recordAudit(
            manager,
            principal.id,
            printer.id,
            'CLOUD_PRINTER_CONFIRM_FAILED',
            { result: 'FAILED', status: printer.status },
          );
          return { failure };
        }

        printer.status = CloudPrinterStatus.ACTIVE;
        printer.bindingStage = PrinterBindingStage.NONE;
        clearChallenge(printer);
        printer.verifiedAt = this.now();
        const saved = await repository.save(printer);
        const snapshot: ConfirmCloudPrinterResult = {
          printer: toSnapshotView(saved),
        };
        await this.idempotencyService.complete(manager, {
          owner: prepared.claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: saved.id,
          responseSnapshot: snapshot,
          sensitiveValues: [
            saved.serialNumber,
            normalized.operationPassword,
            normalized.code,
          ],
        });
        await this.recordAudit(
          manager,
          principal.id,
          saved.id,
          'CLOUD_PRINTER_CONFIRMED',
          { result: 'COMPLETED', status: saved.status },
        );
        return { snapshot };
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('response snapshot contains sensitive value')
      ) {
        throw error;
      }
      return this.failConfirmUnknown(prepared.claim, prepared.printerId);
    }

    if ('failure' in outcome && outcome.failure) {
      throw failedException(outcome.failure);
    }
    if (!('snapshot' in outcome)) throw failedException('INVALID_STATE');
    return this.projectResult(outcome.snapshot);
  }

  async resend(
    principal: AuthenticatedAdmin,
    printerId: string,
    request: ResendCloudPrinterVerificationRequest,
    idempotencyKey: string,
  ): Promise<ResendCloudPrinterVerificationResult> {
    this.assertIdempotencyKey(idempotencyKey);
    if (!request.operationPassword) {
      throw new BadRequestException({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
        message: 'operationPassword is required',
      });
    }
    const claimRequest = {
      printerId,
      operationPassword: request.operationPassword,
    };
    const preflight =
      await this.preflightOperation<ResendCloudPrinterVerificationResult>(
        principal,
        'CLOUD_PRINTER_RESEND',
        idempotencyKey,
        claimRequest,
        (claim) =>
          this.handleReplay<ResendCloudPrinterVerificationResult>(claim),
      );
    if (preflight) return this.projectResult(preflight);
    await this.verifyPassword(principal, request.operationPassword);
    let intent:
      | ChallengeIntent
      | StableOperationOutcome<ResendCloudPrinterVerificationResult>;
    try {
      intent = await this.dataSource.transaction(async (manager) => {
        const claim = await this.idempotencyService.claim(manager, {
          adminId: principal.id,
          operation: 'CLOUD_PRINTER_RESEND' satisfies OperationName,
          key: idempotencyKey,
          request: claimRequest,
        });
        if (claim.kind === 'REPLAY') {
          return this.replayOutcome<ResendCloudPrinterVerificationResult>(
            claim,
          );
        }
        const printer = await manager.getRepository(CloudPrinter).findOne({
          where: { id: printerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!printer) {
          await this.idempotencyService.fail(manager, {
            owner: claim.owner,
            responseSnapshot: this.failureSnapshot('RECOVERY_REQUIRED'),
            sensitiveValues: [request.operationPassword],
          });
          return { failure: 'RECOVERY_REQUIRED' as const };
        }
        if (!this.canResendChallenge(printer)) {
          await this.idempotencyService.fail(manager, {
            owner: claim.owner,
            resourceType: 'CLOUD_PRINTER',
            resourceId: printer.id,
            responseSnapshot: this.failureSnapshot(
              'RECOVERY_REQUIRED',
              printer.id,
            ),
            sensitiveValues: [printer.serialNumber, request.operationPassword],
          });
          return { failure: 'RECOVERY_REQUIRED' as const };
        }
        const currentUnknown =
          printer.bindingOperationId && printer.bindingIdempotencyKey
            ? await manager.getRepository(AdminOperationIdempotency).findOne({
                where: {
                  id: printer.bindingOperationId,
                  operation: In(['CLOUD_PRINTER_BIND', 'CLOUD_PRINTER_RESEND']),
                  key: printer.bindingIdempotencyKey,
                  status: 'UNKNOWN',
                  resourceType: 'CLOUD_PRINTER',
                  resourceId: printer.id,
                },
              })
            : null;
        if (currentUnknown) {
          await this.idempotencyService.fail(manager, {
            owner: claim.owner,
            resourceType: 'CLOUD_PRINTER',
            resourceId: printer.id,
            responseSnapshot: this.failureSnapshot(
              'IDEMPOTENCY_RESULT_UNKNOWN',
              printer.id,
            ),
            sensitiveValues: [printer.serialNumber, request.operationPassword],
          });
          return { failure: 'IDEMPOTENCY_RESULT_UNKNOWN' as const };
        }
        return { claim, printer };
      });
    } catch (error) {
      if (this.isRecoverableIdempotencyError(error)) {
        return this.projectResult(
          await this.reconcileUnknownOperation<ResendCloudPrinterVerificationResult>(
            {
              principal,
              operation: 'CLOUD_PRINTER_RESEND',
              key: idempotencyKey,
              request: claimRequest,
              fallbackPrinterId: printerId,
              fallbackSerialNumber: null,
              sensitiveValues: [request.operationPassword],
            },
          ),
        );
      }
      throw error;
    }
    if ('failure' in intent) throw failedException(intent.failure);
    if ('snapshot' in intent) return this.projectResult(intent.snapshot);

    const code = generateVerificationCode();
    const codeHash = await bcrypt.hash(code, this.verificationCodeBcryptCost);
    let challenge: ChallengeIntent;
    try {
      challenge = await this.dataSource.transaction((manager) =>
        this.saveChallenge(manager, intent, codeHash),
      );
    } catch {
      try {
        await this.fallbackUnknown(
          principal,
          intent.claim,
          intent.printer.id,
          PrinterBindingStage.RECONCILIATION,
          'CLOUD_PRINTER_RESEND_FAILED',
        );
      } catch (fallbackError) {
        throw persistenceUnavailable(fallbackError);
      }
      throw resultUnknown('厂商关联已存在，但本地重发验证码提交中断');
    }

    let print: VendorClassification;
    try {
      print = printClassification(
        await this.vendor.print({
          serialNumber: challenge.printer.serialNumber,
          content: `ownership-code:${code}`,
          tradeOrderId: challengeTradeOrderId(challenge.printer.id),
        }),
      );
    } catch (error) {
      print = errorClassification(error);
    }

    if (print.kind !== 'SUCCESS') {
      await this.finishResendPrintFailure(
        principal,
        challenge,
        print,
        request.operationPassword,
        code,
      );
      if (print.kind === 'UNKNOWN') {
        throw resultUnknown('重发验证码结果未知，必须先收敛原操作');
      }
      throw failedException(mapPrintVendorFailure(print));
    }

    let snapshot: ResendCloudPrinterVerificationResult;
    try {
      snapshot = await this.dataSource.transaction((manager) =>
        this.completeChallenge(
          manager,
          principal,
          challenge,
          request.operationPassword,
          code,
          'CLOUD_PRINTER_RESEND_VERIFICATION',
        ),
      );
    } catch {
      try {
        await this.fallbackUnknown(
          principal,
          challenge.claim,
          challenge.printer.id,
          PrinterBindingStage.RECONCILIATION,
          'CLOUD_PRINTER_RESEND_FAILED',
        );
      } catch (fallbackError) {
        throw persistenceUnavailable(fallbackError);
      }
      throw resultUnknown('厂商已接受重发，但本地完成提交中断');
    }
    return this.projectResult(snapshot);
  }

  async rename(
    principal: AuthenticatedAdmin,
    printerId: string,
    request: RenameCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<RenameCloudPrinterResult> {
    const displayName = normalizeCloudPrinterDisplayName(request.displayName);
    if (displayName === null) {
      throw new BadRequestException({
        code: ApiErrorCode.CLOUD_PRINTER_NAME_INVALID,
        message: 'displayName is invalid',
      });
    }
    this.assertIdempotencyKey(idempotencyKey);
    const current = await this.cloudPrinterRepository().findOne({
      where: { id: printerId },
    });
    if (
      current &&
      displayNameContainsSensitiveSerial(displayName, current.serialNumber)
    ) {
      throw invalidPrinterName();
    }

    const outcome = await this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotencyService.claim(manager, {
        adminId: principal.id,
        operation: 'CLOUD_PRINTER_RENAME' satisfies OperationName,
        key: idempotencyKey,
        request: { printerId, displayName },
      });
      if (claim.kind === 'REPLAY') {
        return { snapshot: this.handleReplay<RenameCloudPrinterResult>(claim) };
      }
      const repository = manager.getRepository(CloudPrinter);
      const printer = await repository.findOne({
        where: { id: printerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!printer) {
        await this.idempotencyService.fail(manager, {
          owner: claim.owner,
          responseSnapshot: this.failureSnapshot('NOT_FOUND'),
          sensitiveValues: [],
        });
        return { failure: 'NOT_FOUND' as const };
      }
      printer.displayName = displayName;
      const saved = await repository.save(printer);
      const snapshot: RenameCloudPrinterResult = {
        printer: toSnapshotView(saved),
      };
      await this.idempotencyService.complete(manager, {
        owner: claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: saved.id,
        responseSnapshot: snapshot,
        sensitiveValues: [saved.serialNumber],
      });
      await this.recordAudit(
        manager,
        principal.id,
        saved.id,
        'CLOUD_PRINTER_RENAMED',
        { result: 'COMPLETED', status: saved.status },
      );
      return { snapshot };
    });
    if ('failure' in outcome && outcome.failure) {
      throw failedException(outcome.failure);
    }
    return this.projectResult(outcome.snapshot);
  }

  async refreshStatus(
    principal: AuthenticatedAdmin,
    printerId: string,
    idempotencyKey: string,
  ): Promise<RefreshCloudPrinterOnlineStatusResult> {
    this.assertIdempotencyKey(idempotencyKey);
    const operation: OperationName = 'CLOUD_PRINTER_REFRESH_ONLINE';
    const prepared = await this.dataSource.transaction<RefreshPrepared>(
      async (manager) => {
        const unresolved = await this.idempotencyService.findUnknownForResource(
          manager,
          {
            adminId: principal.id,
            operation,
            resourceType: 'CLOUD_PRINTER',
            resourceId: printerId,
          },
        );
        if (unresolved && unresolved.identity.key !== idempotencyKey) {
          throw resultUnknown(
            '在线状态结果未知，必须使用原 Idempotency-Key 收敛',
          );
        }
        const claim = await this.idempotencyService.claimOrReconcileUnknown(
          manager,
          {
            adminId: principal.id,
            operation,
            key: idempotencyKey,
            request: { printerId },
          },
        );
        if (claim.kind === 'REPLAY') {
          return {
            kind: 'SNAPSHOT',
            snapshot:
              this.handleReplay<RefreshCloudPrinterOnlineStatusResult>(claim),
          };
        }
        const printer = await manager.getRepository(CloudPrinter).findOne({
          where: { id: printerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (claim.kind === 'UNKNOWN') {
          if (!printer) {
            await this.reconcileRefreshSuperseded(manager, claim.identity, {
              printerId,
              serialNumber: null,
            });
            return { kind: 'FAILURE', failure: 'RECOVERY_REQUIRED' };
          }
          const cycle = this.refreshCycleFromSnapshot(claim.responseSnapshot);
          if (!cycle || !this.sameRefreshCycle(printer, cycle)) {
            await this.reconcileRefreshSuperseded(manager, claim.identity, {
              printerId: printer.id,
              serialNumber: printer.serialNumber,
            });
            return { kind: 'FAILURE', failure: 'RECOVERY_REQUIRED' };
          }
          return {
            kind: 'RECONCILE',
            identity: claim.identity,
            printer,
            cycle,
          };
        }
        if (!printer) {
          await this.idempotencyService.fail(manager, {
            owner: claim.owner,
            responseSnapshot: this.failureSnapshot('NOT_FOUND'),
            sensitiveValues: [],
          });
          return { kind: 'FAILURE', failure: 'NOT_FOUND' };
        }
        if (
          printer.lastStatusCheckedAt !== null &&
          this.now().getTime() - printer.lastStatusCheckedAt.getTime() <
            this.onlineStatusCacheMs
        ) {
          const snapshot = { printer: toSnapshotView(printer) };
          await this.idempotencyService.complete(manager, {
            owner: claim.owner,
            resourceType: 'CLOUD_PRINTER',
            resourceId: printer.id,
            responseSnapshot: snapshot,
            sensitiveValues: [printer.serialNumber],
          });
          return { kind: 'SNAPSHOT', snapshot };
        }
        return {
          kind: 'INTENT',
          claim,
          printer,
          cycle: this.refreshCycle(printer),
        };
      },
    );
    if (prepared.kind === 'SNAPSHOT') {
      return this.projectResult(prepared.snapshot);
    }
    if (prepared.kind === 'FAILURE') throw failedException(prepared.failure);

    const vendorResult = await this.queryOnlineStatus(
      prepared.printer.serialNumber,
    );
    const outcome = await this.dataSource.transaction<RefreshOutcome>(
      async (manager) =>
        prepared.kind === 'RECONCILE'
          ? this.finishUnknownRefresh(
              manager,
              principal,
              prepared,
              vendorResult,
            )
          : this.finishOwnedRefresh(manager, principal, prepared, vendorResult),
    );
    if (outcome.kind === 'UNKNOWN') {
      throw failedException('ONLINE_STATUS_UNKNOWN');
    }
    if (outcome.kind === 'FAILURE') throw failedException(outcome.failure);
    return this.projectResult(outcome.snapshot);
  }

  private refreshCycle(printer: CloudPrinter): RefreshCycle {
    return {
      bindingOperationId: printer.bindingOperationId ?? null,
      version: printer.version,
    };
  }

  private refreshCycleFromSnapshot(
    snapshot: Readonly<Record<string, unknown>> | null,
  ): RefreshCycle | null {
    const bindingOperationId = snapshot?.bindingOperationId;
    const version = snapshot?.version;
    return (bindingOperationId === null ||
      typeof bindingOperationId === 'string') &&
      typeof version === 'number' &&
      Number.isInteger(version) &&
      version >= 0
      ? { bindingOperationId, version }
      : null;
  }

  private sameRefreshCycle(
    printer: CloudPrinter,
    cycle: RefreshCycle,
  ): boolean {
    return (
      (printer.bindingOperationId ?? null) === cycle.bindingOperationId &&
      printer.version === cycle.version
    );
  }

  private async queryOnlineStatus(
    serialNumber: string,
  ): Promise<RefreshVendorResult> {
    try {
      const result = await this.vendor.queryOnline(serialNumber);
      const onlineStatus =
        result.status === 'ONLINE'
          ? CloudPrinterOnlineStatus.ONLINE
          : result.status === 'OFFLINE'
            ? CloudPrinterOnlineStatus.OFFLINE
            : result.status === 'ABNORMAL'
              ? CloudPrinterOnlineStatus.ABNORMAL
              : CloudPrinterOnlineStatus.UNKNOWN;
      return { onlineStatus, vendorCode: result.vendorCode };
    } catch (error) {
      return {
        onlineStatus: CloudPrinterOnlineStatus.UNKNOWN,
        vendorCode: errorClassification(error).vendorCode,
      };
    }
  }

  private async finishOwnedRefresh(
    manager: EntityManager,
    principal: AuthenticatedAdmin,
    intent: Extract<RefreshPrepared, { kind: 'INTENT' }>,
    vendorResult: RefreshVendorResult,
  ): Promise<RefreshOutcome> {
    const repository = manager.getRepository(CloudPrinter);
    const printer = await repository.findOne({
      where: { id: intent.printer.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!printer || !this.sameRefreshCycle(printer, intent.cycle)) {
      await this.idempotencyService.markUnknown(manager, {
        owner: intent.claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: intent.printer.id,
        responseSnapshot: {
          printerId: intent.printer.id,
          ...intent.cycle,
        },
        sensitiveValues: [intent.printer.serialNumber],
      });
      return { kind: 'UNKNOWN' };
    }
    if (vendorResult.onlineStatus === CloudPrinterOnlineStatus.UNKNOWN) {
      await this.idempotencyService.markUnknown(manager, {
        owner: intent.claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: printer.id,
        responseSnapshot: {
          printerId: printer.id,
          ...intent.cycle,
        },
        sensitiveValues: [printer.serialNumber],
      });
      await this.recordAudit(
        manager,
        principal.id,
        printer.id,
        'CLOUD_PRINTER_ONLINE_STATUS_REFRESHED',
        { result: 'UNKNOWN', status: printer.status },
      );
      return { kind: 'UNKNOWN' };
    }
    return this.completeOwnedRefresh(
      manager,
      principal,
      intent,
      printer,
      vendorResult.onlineStatus,
    );
  }

  private async completeOwnedRefresh(
    manager: EntityManager,
    principal: AuthenticatedAdmin,
    intent: Extract<RefreshPrepared, { kind: 'INTENT' }>,
    printer: CloudPrinter,
    onlineStatus: CloudPrinterOnlineStatus,
  ): Promise<RefreshOutcome> {
    const repository = manager.getRepository(CloudPrinter);
    printer.lastOnlineStatus = onlineStatus;
    printer.lastStatusCheckedAt = this.now();
    printer.lastVendorErrorCode = null;
    const saved = await repository.save(printer);
    const snapshot = { printer: toSnapshotView(saved) };
    await this.idempotencyService.complete(manager, {
      owner: intent.claim.owner,
      resourceType: 'CLOUD_PRINTER',
      resourceId: saved.id,
      responseSnapshot: snapshot,
      sensitiveValues: [saved.serialNumber],
    });
    await this.recordAudit(
      manager,
      principal.id,
      saved.id,
      'CLOUD_PRINTER_ONLINE_STATUS_REFRESHED',
      { result: 'COMPLETED', onlineStatus: saved.lastOnlineStatus },
    );
    return { kind: 'SNAPSHOT', snapshot };
  }

  private async finishUnknownRefresh(
    manager: EntityManager,
    principal: AuthenticatedAdmin,
    intent: Extract<RefreshPrepared, { kind: 'RECONCILE' }>,
    vendorResult: RefreshVendorResult,
  ): Promise<RefreshOutcome> {
    const repository = manager.getRepository(CloudPrinter);
    const printer = await repository.findOne({
      where: { id: intent.printer.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!printer || !this.sameRefreshCycle(printer, intent.cycle)) {
      await this.reconcileRefreshSuperseded(manager, intent.identity, {
        printerId: intent.printer.id,
        serialNumber: printer?.serialNumber ?? intent.printer.serialNumber,
      });
      return { kind: 'FAILURE', failure: 'RECOVERY_REQUIRED' };
    }
    const saved =
      vendorResult.onlineStatus === CloudPrinterOnlineStatus.UNKNOWN
        ? printer
        : await repository.save(
            Object.assign(printer, {
              lastOnlineStatus: vendorResult.onlineStatus,
              lastStatusCheckedAt: this.now(),
              lastVendorErrorCode: null,
            }),
          );
    const reconciled = await this.idempotencyService
      .reconcileUnknownByIdentity(manager, {
        identity: intent.identity,
        sensitiveValues: [saved.serialNumber],
        reconcile: async () =>
          vendorResult.onlineStatus === CloudPrinterOnlineStatus.UNKNOWN
            ? {
                status: 'UNKNOWN',
                resourceType: 'CLOUD_PRINTER',
                resourceId: saved.id,
                responseSnapshot: {
                  printerId: saved.id,
                  ...intent.cycle,
                },
              }
            : {
                status: 'COMPLETED',
                resourceType: 'CLOUD_PRINTER',
                resourceId: saved.id,
                responseSnapshot: { printer: toSnapshotView(saved) },
              },
      })
      .catch((error: unknown) => {
        if (apiCodeOf(error) === ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN) {
          return null;
        }
        throw error;
      });
    await this.recordAudit(
      manager,
      principal.id,
      saved.id,
      'CLOUD_PRINTER_ONLINE_STATUS_REFRESHED',
      {
        result:
          vendorResult.onlineStatus === CloudPrinterOnlineStatus.UNKNOWN
            ? 'UNKNOWN'
            : 'COMPLETED',
        status: saved.status,
      },
    );
    return reconciled?.kind === 'REPLAY' && reconciled.status === 'COMPLETED'
      ? {
          kind: 'SNAPSHOT',
          snapshot:
            reconciled.responseSnapshot as RefreshCloudPrinterOnlineStatusResult,
        }
      : { kind: 'UNKNOWN' };
  }

  private async reconcileRefreshSuperseded(
    manager: EntityManager,
    identity: OperationIdentity,
    resource: Readonly<{
      printerId: string;
      serialNumber: string | null;
    }>,
  ): Promise<void> {
    await this.idempotencyService.reconcileUnknownByIdentity(manager, {
      identity,
      sensitiveValues:
        resource.serialNumber === null ? [] : [resource.serialNumber],
      reconcile: async () => ({
        status: 'FAILED',
        resourceType: 'CLOUD_PRINTER',
        resourceId: resource.printerId,
        responseSnapshot: {
          printerId: resource.printerId,
          code: 'RECOVERY_REQUIRED',
        },
      }),
    });
  }

  async unbind(
    principal: AuthenticatedAdmin,
    printerId: string,
    request: UnbindCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<UnbindCloudPrinterResult> {
    this.assertIdempotencyKey(idempotencyKey);
    await this.verifyPassword(principal, request.operationPassword);
    const prepared = await this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotencyService.claim(manager, {
        adminId: principal.id,
        operation: 'PRINT_DEVICE_UNBIND' satisfies OperationName,
        key: idempotencyKey,
        request: { printerId, operationPassword: request.operationPassword },
      });
      if (claim.kind === 'REPLAY') {
        return {
          kind: 'REPLAY' as const,
          result: this.handleReplay<UnbindCloudPrinterResult>(claim),
        };
      }
      await this.currentPrinters?.assertNotCurrentForUnbind(manager, printerId);
      const printer = await manager.getRepository(CloudPrinter).findOne({
        where: { id: printerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!printer || printer.status !== CloudPrinterStatus.ACTIVE) {
        await this.idempotencyService.fail(manager, {
          owner: claim.owner,
          resourceType: printer ? 'CLOUD_PRINTER' : null,
          resourceId: printer?.id ?? null,
          responseSnapshot: this.failureSnapshot(
            'RECOVERY_REQUIRED',
            printer?.id,
          ),
          sensitiveValues: [request.operationPassword],
        });
        return {
          kind: 'FAILURE' as const,
          failure: 'RECOVERY_REQUIRED' as const,
        };
      }
      const [blockingBatch, blockingJob] = await Promise.all([
        manager.getRepository(PrintBatch).findOne({
          where: {
            printerId,
            status: In([
              PrintBatchStatus.DRAFT,
              PrintBatchStatus.READY,
              PrintBatchStatus.RUNNING,
              PrintBatchStatus.PAUSED,
            ]),
          },
        }),
        manager.getRepository(PrintJob).findOne({
          where: {
            printerId,
            status: In([
              PrintJobStatus.PENDING,
              PrintJobStatus.SUBMITTING,
              PrintJobStatus.UNKNOWN,
              PrintJobStatus.MANUAL_REVIEW,
            ]),
          },
        }),
      ]);
      if (blockingBatch || blockingJob) {
        await this.idempotencyService.fail(manager, {
          owner: claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: printer.id,
          responseSnapshot: this.failureSnapshot('UNBIND_BLOCKED', printer.id),
          sensitiveValues: [printer.serialNumber, request.operationPassword],
        });
        return { kind: 'FAILURE' as const, failure: 'UNBIND_BLOCKED' as const };
      }
      printer.status = CloudPrinterStatus.UNBINDING;
      printer.bindingStage = PrinterBindingStage.UNBIND_DELETE;
      printer.vendorRelationState = VendorRelationState.CONFIRMED_BOUND;
      printer.bindingOperationId = claim.owner.id;
      printer.bindingIdempotencyKey = idempotencyKey;
      const saved = await manager.getRepository(CloudPrinter).save(printer);
      return { kind: 'OWNER' as const, claim, printer: saved };
    });
    if (prepared.kind === 'REPLAY') {
      return this.projectResult(prepared.result);
    }
    if (prepared.kind === 'FAILURE') throw failedException(prepared.failure);

    let deletion: VendorClassification;
    try {
      const result = await this.vendor.deletePrinter(
        prepared.printer.serialNumber,
      );
      deletion = { kind: 'SUCCESS', vendorCode: result.vendorCode };
    } catch (error) {
      deletion = errorClassification(error);
    }

    const outcome = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CloudPrinter);
      const printer = await repository.findOne({
        where: { id: prepared.printer.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!printer || printer.bindingOperationId !== prepared.claim.owner.id) {
        throw resultUnknown('解绑周期已变化，必须先收敛原操作');
      }
      if (deletion.kind === 'SUCCESS') {
        printer.status = CloudPrinterStatus.UNBOUND;
        printer.bindingStage = PrinterBindingStage.NONE;
        printer.vendorRelationState = VendorRelationState.CONFIRMED_UNBOUND;
        printer.unboundAt = this.now();
        printer.lastOnlineStatus = CloudPrinterOnlineStatus.UNKNOWN;
        printer.lastStatusCheckedAt = null;
        const saved = await repository.save(printer);
        const snapshot = { printer: toSnapshotView(saved) };
        await this.idempotencyService.complete(manager, {
          owner: prepared.claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: saved.id,
          responseSnapshot: snapshot,
          sensitiveValues: [saved.serialNumber, request.operationPassword],
        });
        await this.recordAudit(
          manager,
          principal.id,
          saved.id,
          'CLOUD_PRINTER_UNBOUND',
          {
            result: 'COMPLETED',
            status: saved.status,
          },
        );
        return { snapshot };
      }
      printer.status =
        deletion.kind === 'UNKNOWN'
          ? CloudPrinterStatus.ERROR
          : CloudPrinterStatus.ACTIVE;
      printer.bindingStage =
        deletion.kind === 'UNKNOWN'
          ? PrinterBindingStage.UNBIND_DELETE
          : PrinterBindingStage.NONE;
      printer.vendorRelationState =
        deletion.kind === 'UNKNOWN'
          ? VendorRelationState.UNKNOWN
          : VendorRelationState.CONFIRMED_BOUND;
      printer.lastVendorErrorCode = deletion.vendorCode;
      const saved = await repository.save(printer);
      if (deletion.kind === 'UNKNOWN') {
        await this.idempotencyService.markUnknown(manager, {
          owner: prepared.claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: saved.id,
        });
        return { failure: 'IDEMPOTENCY_RESULT_UNKNOWN' as const };
      }
      await this.idempotencyService.fail(manager, {
        owner: prepared.claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: saved.id,
        responseSnapshot: this.failureSnapshot('VENDOR_REJECTED', saved.id),
        sensitiveValues: [saved.serialNumber, request.operationPassword],
      });
      return { failure: 'VENDOR_REJECTED' as const };
    });
    if ('failure' in outcome && outcome.failure) {
      throw failedException(outcome.failure);
    }
    if (!('snapshot' in outcome)) {
      throw failedException('IDEMPOTENCY_RESULT_UNKNOWN');
    }
    return this.projectResult(outcome.snapshot);
  }

  async list(query: CloudPrinterListQuery): Promise<CloudPrinterListResult> {
    const current = this.currentPrinters
      ? await this.currentPrinters.get()
      : { printer: null };
    const where = query.status
      ? { status: query.status }
      : query.includeUnbound
        ? {}
        : {
            status: Not(CloudPrinterStatus.UNBOUND),
            unboundAt: IsNull(),
          };
    const [printers, total] = await this.cloudPrinterRepository().findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      items: printers.map((printer) =>
        toView(printer, current.printer?.id === printer.id),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(printerId: string): Promise<CloudPrinterView> {
    const [printer, current] = await Promise.all([
      this.cloudPrinterRepository().findOne({ where: { id: printerId } }),
      this.currentPrinters
        ? this.currentPrinters.get()
        : Promise.resolve({ printer: null }),
    ]);
    if (!printer) {
      throw new NotFoundException({
        code: ApiErrorCode.CLOUD_PRINTER_NOT_FOUND,
        message: '打印机不存在',
      });
    }
    return toView(printer, current.printer?.id === printer.id);
  }

  private async claimBindIntent(
    manager: EntityManager,
    principal: AuthenticatedAdmin,
    normalized: {
      serialNumber: string;
      displayName: string;
      operationPassword: string;
    },
    idempotencyKey: string,
    claimRequest: unknown,
  ): Promise<BindIntent | StableOperationOutcome<BindCloudPrinterResult>> {
    const claim = await this.idempotencyService.claim(manager, {
      adminId: principal.id,
      operation: 'CLOUD_PRINTER_BIND' satisfies OperationName,
      key: idempotencyKey,
      request: claimRequest,
    });
    if (claim.kind === 'REPLAY') {
      return this.replayOutcome<BindCloudPrinterResult>(claim);
    }
    const repository = manager.getRepository(CloudPrinter);
    const existing = await repository.findOne({
      where: { serialNumber: normalized.serialNumber },
      lock: { mode: 'pessimistic_write' },
    });
    if (existing && existing.status !== CloudPrinterStatus.UNBOUND) {
      await this.idempotencyService.fail(manager, {
        owner: claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: existing.id,
        responseSnapshot: this.failureSnapshot(
          'OWNERSHIP_CONFLICT',
          existing.id,
        ),
        sensitiveValues: [
          normalized.serialNumber,
          normalized.operationPassword,
        ],
      });
      await this.recordAudit(
        manager,
        principal.id,
        existing.id,
        'CLOUD_PRINTER_BIND_FAILED',
        { result: 'FAILED', status: existing.status },
      );
      return { failure: 'OWNERSHIP_CONFLICT' };
    }

    const priorOwnershipProven = Boolean(existing?.verifiedAt);
    const printer = existing ?? repository.create();
    printer.serialNumber = normalized.serialNumber;
    printer.displayName = normalized.displayName;
    printer.status = CloudPrinterStatus.BINDING;
    printer.bindingStage = PrinterBindingStage.ADD_PRINTER;
    printer.vendorRelationState = VendorRelationState.UNKNOWN;
    printer.bindingIdempotencyKey = idempotencyKey;
    printer.boundByAdminId = principal.id;
    printer.unboundAt = null;
    clearChallenge(printer);
    if (!existing) printer.verifiedAt = null;
    printer.lastOnlineStatus = CloudPrinterOnlineStatus.UNKNOWN;
    printer.lastStatusCheckedAt = null;
    printer.lastVendorErrorCode = null;
    printer.bindingOperationId = claim.owner.id;
    const saved = await repository.save(printer);
    await this.recordAudit(
      manager,
      principal.id,
      saved.id,
      'CLOUD_PRINTER_BINDING_INTENT_CREATED',
      {
        result: 'INITIATED',
        status: saved.status,
        bindingStage: saved.bindingStage,
      },
    );
    return { claim, printer: saved, priorOwnershipProven };
  }

  private async saveChallenge(
    manager: EntityManager,
    intent: ChallengeIntent,
    codeHash: string,
  ): Promise<ChallengeIntent> {
    const repository = manager.getRepository(CloudPrinter);
    const printer = await repository.findOne({
      where: { id: intent.printer.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!printer || printer.version !== intent.printer.version) {
      throw new ConflictException({
        code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
        message: '打印机状态已改变',
      });
    }
    printer.status = CloudPrinterStatus.BINDING;
    printer.bindingStage = PrinterBindingStage.PRINT_VERIFICATION_CODE;
    printer.vendorRelationState = VendorRelationState.CONFIRMED_BOUND;
    printer.bindingIdempotencyKey = intent.claim.owner.key;
    printer.bindingOperationId = intent.claim.owner.id;
    printer.verificationCodeHash = codeHash;
    printer.verificationExpiresAt = new Date(
      this.now().getTime() + this.verificationWindowMs,
    );
    printer.verificationFailedAttempts = 0;
    const saved = await repository.save(printer);
    await this.recordAudit(
      manager,
      intent.claim.owner.adminId,
      saved.id,
      'CLOUD_PRINTER_ADD_CONFIRMED',
      {
        result: 'ACCEPTED',
        status: saved.status,
        bindingStage: saved.bindingStage,
      },
    );
    return { claim: intent.claim, printer: saved };
  }

  private async completeChallenge(
    manager: EntityManager,
    principal: AuthenticatedAdmin,
    intent: ChallengeIntent,
    operationPassword: string,
    code: string,
    action:
      'CLOUD_PRINTER_BIND_INITIATED' | 'CLOUD_PRINTER_RESEND_VERIFICATION',
  ): Promise<BindCloudPrinterResult | ResendCloudPrinterVerificationResult> {
    const repository = manager.getRepository(CloudPrinter);
    const printer = await repository.findOne({
      where: { id: intent.printer.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !printer ||
      printer.version !== intent.printer.version ||
      printer.bindingStage !== PrinterBindingStage.PRINT_VERIFICATION_CODE
    ) {
      throw new Error('challenge completion CAS failed');
    }
    printer.status = CloudPrinterStatus.PENDING_VERIFICATION;
    printer.bindingStage = PrinterBindingStage.NONE;
    printer.lastVendorErrorCode = null;
    const saved = await repository.save(printer);
    const snapshot = {
      printer: toSnapshotView(saved),
      challenge: {
        challengeId: saved.id,
        expiresAt: saved.verificationExpiresAt!.toISOString(),
        remainingAttempts: this.verificationMaxAttempts,
      },
    };
    await this.idempotencyService.complete(manager, {
      owner: intent.claim.owner,
      resourceType: 'CLOUD_PRINTER',
      resourceId: saved.id,
      responseSnapshot: snapshot,
      sensitiveValues: [saved.serialNumber, operationPassword, code],
    });
    await this.recordAudit(manager, principal.id, saved.id, action, {
      result: 'ACCEPTED',
      status: saved.status,
      bindingStage: saved.bindingStage,
    });
    return snapshot;
  }

  private async queryAlreadyExistingOwnership(
    serialNumber: string,
  ): Promise<VendorClassification> {
    try {
      const result = await this.vendor.queryOnline(serialNumber);
      return result.status === 'ONLINE' ||
        result.status === 'OFFLINE' ||
        result.status === 'ABNORMAL'
        ? { kind: 'SUCCESS', vendorCode: result.vendorCode }
        : { kind: 'UNKNOWN', vendorCode: result.vendorCode };
    } catch (error) {
      const classification = errorClassification(error);
      if (
        classification.kind === 'FAILED' &&
        classification.vendorCode !== null &&
        (OWNERSHIP_CONFLICT_VENDOR_CODES.has(classification.vendorCode) ||
          NOT_REGISTERED_VENDOR_CODES.has(classification.vendorCode))
      ) {
        return classification;
      }
      return { kind: 'UNKNOWN', vendorCode: classification.vendorCode };
    }
  }

  private async finishAddFailure(
    principal: AuthenticatedAdmin,
    intent: BindIntent,
    add: Exclude<VendorClassification, { kind: 'SUCCESS' }>,
    failureCode: FailureCode,
    normalized: {
      serialNumber: string;
      operationPassword: string;
    },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CloudPrinter);
      const printer = await repository.findOne({
        where: { id: intent.printer.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!printer) throw new Error('bind failure printer missing');
      const confirmedUnbound =
        add.kind === 'FAILED' &&
        (failureCode !== 'OWNERSHIP_CONFLICT' ||
          (add.vendorCode !== null &&
            NOT_REGISTERED_VENDOR_CODES.has(add.vendorCode)));
      printer.status = confirmedUnbound
        ? CloudPrinterStatus.UNBOUND
        : CloudPrinterStatus.ERROR;
      printer.bindingStage = confirmedUnbound
        ? PrinterBindingStage.NONE
        : PrinterBindingStage.RECONCILIATION;
      printer.vendorRelationState = confirmedUnbound
        ? VendorRelationState.CONFIRMED_UNBOUND
        : VendorRelationState.UNKNOWN;
      printer.unboundAt =
        printer.status === CloudPrinterStatus.UNBOUND ? this.now() : null;
      printer.lastVendorErrorCode = add.vendorCode;
      clearChallenge(printer);
      const saved = await repository.save(printer);
      if (add.kind === 'UNKNOWN') {
        await this.idempotencyService.markUnknown(manager, {
          owner: intent.claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: saved.id,
        });
      } else {
        await this.idempotencyService.fail(manager, {
          owner: intent.claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: saved.id,
          responseSnapshot: this.failureSnapshot(failureCode, saved.id),
          sensitiveValues: [
            normalized.serialNumber,
            normalized.operationPassword,
          ],
        });
      }
      await this.recordAudit(
        manager,
        principal.id,
        saved.id,
        'CLOUD_PRINTER_BIND_FAILED',
        {
          result: add.kind,
          status: saved.status,
          vendorCode: add.vendorCode,
        },
      );
    });
  }

  private async finishBindPrintUnknown(
    principal: AuthenticatedAdmin,
    intent: ChallengeIntent,
    print: Extract<VendorClassification, { kind: 'UNKNOWN' }>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CloudPrinter);
      const printer = await repository.findOne({
        where: { id: intent.printer.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!printer) throw new Error('unknown print printer missing');
      clearChallenge(printer);
      printer.status = CloudPrinterStatus.ERROR;
      printer.bindingStage = PrinterBindingStage.RECONCILIATION;
      printer.vendorRelationState = VendorRelationState.CONFIRMED_BOUND;
      printer.unboundAt = null;
      printer.lastVendorErrorCode = print.vendorCode;
      const saved = await repository.save(printer);
      await this.idempotencyService.markUnknown(manager, {
        owner: intent.claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: saved.id,
      });
      await this.recordAudit(
        manager,
        principal.id,
        saved.id,
        'CLOUD_PRINTER_BIND_FAILED',
        {
          result: 'UNKNOWN',
          status: saved.status,
          vendorCode: print.vendorCode,
        },
      );
    });
  }

  private async finishBindPrintFailure(
    principal: AuthenticatedAdmin,
    intent: ChallengeIntent,
    print: Exclude<VendorClassification, { kind: 'SUCCESS' }>,
    deletion: VendorClassification,
    normalized: { operationPassword: string },
    code: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CloudPrinter);
      const printer = await repository.findOne({
        where: { id: intent.printer.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!printer) throw new Error('print compensation printer missing');
      clearChallenge(printer);
      if (deletion.kind === 'SUCCESS') {
        printer.status = CloudPrinterStatus.UNBOUND;
        printer.bindingStage = PrinterBindingStage.NONE;
        printer.vendorRelationState = VendorRelationState.CONFIRMED_UNBOUND;
        printer.unboundAt = this.now();
        printer.lastVendorErrorCode = print.vendorCode;
      } else {
        printer.status = CloudPrinterStatus.ERROR;
        printer.bindingStage = PrinterBindingStage.COMPENSATION_DELETE;
        printer.vendorRelationState =
          deletion.kind === 'FAILED'
            ? VendorRelationState.CONFIRMED_BOUND
            : VendorRelationState.UNKNOWN;
        printer.unboundAt = null;
        printer.lastVendorErrorCode = deletion.vendorCode ?? print.vendorCode;
      }
      const saved = await repository.save(printer);
      if (print.kind === 'UNKNOWN' || deletion.kind === 'UNKNOWN') {
        await this.idempotencyService.markUnknown(manager, {
          owner: intent.claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: saved.id,
        });
      } else {
        const failureCode: FailureCode =
          deletion.kind === 'SUCCESS'
            ? mapPrintVendorFailure(print)
            : 'RECOVERY_REQUIRED';
        await this.idempotencyService.fail(manager, {
          owner: intent.claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: saved.id,
          responseSnapshot: this.failureSnapshot(failureCode, saved.id),
          sensitiveValues: [
            saved.serialNumber,
            normalized.operationPassword,
            code,
          ],
        });
      }
      await this.recordAudit(
        manager,
        principal.id,
        saved.id,
        'CLOUD_PRINTER_BIND_FAILED',
        {
          result: deletion.kind === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED',
          status: saved.status,
          vendorCode: deletion.vendorCode ?? print.vendorCode,
        },
      );
    });
  }

  private async finishResendPrintFailure(
    principal: AuthenticatedAdmin,
    intent: ChallengeIntent,
    print: Exclude<VendorClassification, { kind: 'SUCCESS' }>,
    operationPassword: string,
    code: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CloudPrinter);
      const printer = await repository.findOne({
        where: { id: intent.printer.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!printer) throw new Error('resend printer missing');
      clearChallenge(printer);
      printer.status = CloudPrinterStatus.ERROR;
      printer.bindingStage = PrinterBindingStage.PRINT_VERIFICATION_CODE;
      printer.lastVendorErrorCode = print.vendorCode;
      const saved = await repository.save(printer);
      if (print.kind === 'UNKNOWN') {
        await this.idempotencyService.markUnknown(manager, {
          owner: intent.claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: saved.id,
        });
      } else {
        await this.idempotencyService.fail(manager, {
          owner: intent.claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: saved.id,
          responseSnapshot: this.failureSnapshot(
            mapPrintVendorFailure(print),
            saved.id,
          ),
          sensitiveValues: [saved.serialNumber, operationPassword, code],
        });
      }
      await this.recordAudit(
        manager,
        principal.id,
        saved.id,
        'CLOUD_PRINTER_RESEND_FAILED',
        {
          result: print.kind,
          status: saved.status,
          vendorCode: print.vendorCode,
        },
      );
    });
  }

  private canResendChallenge(printer: CloudPrinter): boolean {
    if (printer.vendorRelationState !== VendorRelationState.CONFIRMED_BOUND) {
      return false;
    }
    if (printer.status === CloudPrinterStatus.PENDING_VERIFICATION) {
      return (
        printer.bindingStage === PrinterBindingStage.NONE ||
        printer.bindingStage === PrinterBindingStage.PRINT_VERIFICATION_CODE
      );
    }
    return (
      (printer.status === CloudPrinterStatus.BINDING ||
        printer.status === CloudPrinterStatus.ERROR) &&
      (printer.bindingStage === PrinterBindingStage.PRINT_VERIFICATION_CODE ||
        printer.bindingStage === PrinterBindingStage.RECONCILIATION)
    );
  }

  private confirmFailure(
    printer: CloudPrinter,
    matches: boolean,
  ): FailureCode | null {
    if (
      printer.status === CloudPrinterStatus.ERROR &&
      printer.verificationFailedAttempts >= this.verificationMaxAttempts
    ) {
      return 'ATTEMPTS_EXHAUSTED';
    }
    if (
      printer.status !== CloudPrinterStatus.PENDING_VERIFICATION ||
      !printer.verificationCodeHash ||
      !printer.verificationExpiresAt
    ) {
      return 'INVALID_STATE';
    }
    if (printer.verificationExpiresAt.getTime() <= this.now().getTime()) {
      return 'EXPIRED';
    }
    return matches ? null : 'CODE_INVALID';
  }

  private async fallbackUnknown(
    principal: AuthenticatedAdmin,
    claim: OwnerClaim,
    printerId: string,
    bindingStage: PrinterBindingStage,
    action: 'CLOUD_PRINTER_BIND_FAILED' | 'CLOUD_PRINTER_RESEND_FAILED',
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CloudPrinter);
      const printer = await repository.findOne({
        where: { id: printerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (printer) {
        printer.status = CloudPrinterStatus.ERROR;
        printer.bindingStage = bindingStage;
        printer.vendorRelationState = VendorRelationState.CONFIRMED_BOUND;
        clearChallenge(printer);
        const saved = await repository.save(printer);
        await this.recordAudit(manager, principal.id, saved.id, action, {
          result: 'UNKNOWN',
          status: saved.status,
        });
      }
      await this.idempotencyService.markUnknown(manager, {
        owner: claim.owner,
        resourceType: 'CLOUD_PRINTER',
        resourceId: printerId,
      });
    });
  }

  private async reconcileUnknownOperation<T>(
    input: Readonly<{
      principal: AuthenticatedAdmin;
      operation: 'CLOUD_PRINTER_BIND' | 'CLOUD_PRINTER_RESEND';
      key: string;
      request: unknown;
      fallbackPrinterId: string | null;
      fallbackSerialNumber: string | null;
      sensitiveValues: readonly string[];
    }>,
  ): Promise<T> {
    const fenced = await this.dataSource.transaction((manager) =>
      this.idempotencyService.fenceStaleInProgress(manager, {
        adminId: input.principal.id,
        operation: input.operation,
        key: input.key,
        request: input.request,
        now: this.now(),
      }),
    );
    if (fenced.kind === 'REPLAY') return this.handleReplay<T>(fenced);

    const printer = await this.resolveReconciliationPrinter(
      fenced,
      input.fallbackPrinterId,
      input.fallbackSerialNumber,
    );
    const evidence = printer
      ? await this.queryRelationEvidence(printer.serialNumber)
      : 'UNKNOWN';

    const claim = await this.dataSource.transaction((manager) =>
      this.idempotencyService.reconcileUnknown(manager, {
        adminId: input.principal.id,
        operation: input.operation,
        key: input.key,
        request: input.request,
        sensitiveValues: [
          ...input.sensitiveValues,
          ...(printer ? [printer.serialNumber] : []),
        ],
        reconcile: async () => {
          if (!printer || evidence === 'UNKNOWN') {
            return {
              status: 'UNKNOWN',
              resourceType: 'CLOUD_PRINTER',
              resourceId: printer?.id ?? null,
              responseSnapshot: null,
            };
          }
          const repository = manager.getRepository(CloudPrinter);
          const current = await repository.findOne({
            where: { id: printer.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!current) {
            return {
              status: 'UNKNOWN',
              resourceType: 'CLOUD_PRINTER',
              resourceId: printer.id,
              responseSnapshot: null,
            };
          }
          if (evidence === 'CONFIRMED_UNBOUND') {
            current.status = CloudPrinterStatus.UNBOUND;
            current.bindingStage = PrinterBindingStage.NONE;
            current.vendorRelationState = VendorRelationState.CONFIRMED_UNBOUND;
            current.unboundAt = this.now();
            clearChallenge(current);
          } else {
            current.status = CloudPrinterStatus.ERROR;
            current.bindingStage = PrinterBindingStage.RECONCILIATION;
            current.vendorRelationState = VendorRelationState.CONFIRMED_BOUND;
            current.unboundAt = null;
          }
          const saved = await repository.save(current);
          await this.recordAudit(
            manager,
            input.principal.id,
            saved.id,
            'CLOUD_PRINTER_OPERATION_RECONCILED',
            { result: 'FAILED', status: saved.status },
          );
          return {
            status: 'FAILED',
            resourceType: 'CLOUD_PRINTER',
            resourceId: saved.id,
            responseSnapshot: {
              printerId: saved.id,
              code: 'RECOVERY_REQUIRED',
            },
          };
        },
      }),
    );
    return this.handleReplay<T>(claim as ReplayClaim);
  }

  private async resolveReconciliationPrinter(
    fenced: FenceStaleInProgressResult,
    fallbackPrinterId: string | null,
    fallbackSerialNumber: string | null,
  ): Promise<CloudPrinter | null> {
    const repository = this.cloudPrinterRepository();
    const resourceId =
      'resourceId' in fenced ? fenced.resourceId : fallbackPrinterId;
    if (resourceId) {
      const byId = await repository.findOne({ where: { id: resourceId } });
      if (byId) return byId;
    }
    if (fallbackPrinterId) {
      const byId = await repository.findOne({
        where: { id: fallbackPrinterId },
      });
      if (byId) return byId;
    }
    return fallbackSerialNumber
      ? repository.findOne({ where: { serialNumber: fallbackSerialNumber } })
      : null;
  }

  private async queryRelationEvidence(
    serialNumber: string,
  ): Promise<RelationEvidence> {
    try {
      const result = await this.vendor.queryOnline(serialNumber);
      return result.status === 'ONLINE' ||
        result.status === 'OFFLINE' ||
        result.status === 'ABNORMAL'
        ? 'CONFIRMED_BOUND'
        : 'UNKNOWN';
    } catch (error) {
      const classification = errorClassification(error);
      return classification.kind === 'FAILED' &&
        classification.vendorCode === '1002'
        ? 'CONFIRMED_UNBOUND'
        : 'UNKNOWN';
    }
  }

  private replayOutcome<T>(claim: ReplayClaim): StableOperationOutcome<T> {
    return claim.status === 'COMPLETED'
      ? { snapshot: normalizeCloudPrinterSnapshot(claim.responseSnapshot) as T }
      : { failure: this.failureCodeFromSnapshot(claim.responseSnapshot) };
  }

  private handleReplay<T>(claim: ReplayClaim): T {
    if (claim.status === 'COMPLETED') {
      return normalizeCloudPrinterSnapshot(claim.responseSnapshot) as T;
    }
    throw failedException(this.failureCodeFromSnapshot(claim.responseSnapshot));
  }

  private failureSnapshot(
    code: FailureCode,
    printerId?: string,
  ): StableFailureSnapshot {
    return printerId === undefined ? { code } : { printerId, code };
  }

  private failureCodeFromSnapshot(
    snapshot: Readonly<Record<string, unknown>> | null,
  ): FailureCode {
    const code = snapshot?.code;
    return typeof code === 'string' && this.isFailureCode(code)
      ? code
      : 'RECOVERY_REQUIRED';
  }

  private isFailureCode(code: string): code is FailureCode {
    return (
      code === 'SERIAL_INVALID' ||
      code === 'VENDOR_REJECTED' ||
      code === 'VENDOR_LIMIT' ||
      code === 'VENDOR_RATE_LIMITED' ||
      code === 'VENDOR_UNAVAILABLE' ||
      code === 'OWNERSHIP_CONFLICT' ||
      code === 'RECOVERY_REQUIRED' ||
      code === 'CODE_INVALID' ||
      code === 'ATTEMPTS_EXHAUSTED' ||
      code === 'EXPIRED' ||
      code === 'INVALID_STATE' ||
      code === 'ONLINE_STATUS_UNKNOWN' ||
      code === 'NOT_FOUND' ||
      code === 'UNBIND_BLOCKED' ||
      code === 'IDEMPOTENCY_RESULT_UNKNOWN'
    );
  }

  private async preflightConfirmOperation<T>(
    principal: AuthenticatedAdmin,
    key: string,
    request: unknown,
    replay: (claim: ReplayClaim) => T,
  ): Promise<T | null> {
    const operation = 'CLOUD_PRINTER_CONFIRM' satisfies OperationName;
    const lookup = await this.idempotencyService.lookup(
      {
        getRepository: (entity) => this.dataSource.getRepository(entity),
      },
      {
        adminId: principal.id,
        operation,
        key,
        request,
      },
    );
    if (lookup.kind === 'ABSENT') return null;
    if (lookup.kind === 'REPLAY') return replay(lookup);
    if (lookup.status === 'UNKNOWN') {
      throw resultUnknown('操作结果未知，必须显式恢复后再继续');
    }

    let fenced: FenceStaleInProgressResult;
    try {
      fenced = await this.dataSource.transaction((manager) =>
        this.idempotencyService.fenceStaleInProgress(manager, {
          adminId: principal.id,
          operation,
          key,
          request,
          now: this.now(),
        }),
      );
    } catch (error) {
      if (apiCodeOf(error) === ApiErrorCode.IDEMPOTENCY_IN_PROGRESS) {
        throw error;
      }
      throw persistenceUnavailable(error);
    }
    if (fenced.kind === 'REPLAY') return replay(fenced);
    throw resultUnknown('操作结果未知，必须显式恢复后再继续');
  }

  private async failConfirmUnknown(
    claim: OwnerClaim,
    printerId: string,
  ): Promise<never> {
    try {
      await this.dataSource.transaction((manager) =>
        this.idempotencyService.markUnknown(manager, {
          owner: claim.owner,
          resourceType: 'CLOUD_PRINTER',
          resourceId: printerId,
        }),
      );
    } catch (fallbackError) {
      throw persistenceUnavailable(fallbackError);
    }
    throw resultUnknown('打印机确认结果未知，必须先收敛原操作');
  }

  private async preflightOperation<T>(
    principal: AuthenticatedAdmin,
    operation: OperationName,
    key: string,
    request: unknown,
    replay: (claim: ReplayClaim) => T,
    allowUnknown = false,
  ): Promise<T | null> {
    const lookup = await this.idempotencyService.lookup(
      {
        getRepository: (entity) => this.dataSource.getRepository(entity),
      },
      {
        adminId: principal.id,
        operation,
        key,
        request,
      },
    );
    if (lookup.kind === 'ABSENT') return null;
    if (lookup.kind === 'CONTINUE') {
      if (lookup.status === 'IN_PROGRESS' || allowUnknown) return null;
      throw new ConflictException({
        code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
        message: '操作结果未知，必须显式恢复后再继续',
      });
    }
    return replay(lookup);
  }

  private async verifyPassword(
    principal: AuthenticatedAdmin,
    candidatePassword: string,
  ): Promise<void> {
    await this.verification.verifyPassword({
      adminId: principal.id,
      candidatePassword,
      now: this.now(),
      context: VERIFICATION_OPERATION_CONTEXT,
    });
  }

  private normalizeBindInput(request: BindCloudPrinterRequest): {
    serialNumber: string;
    displayName: string;
    operationPassword: string;
  } {
    const serialNumber = normalizeCloudPrinterSerialNumber(
      request.serialNumber,
    );
    const displayName = normalizeCloudPrinterDisplayName(request.displayName);
    if (serialNumber === null) {
      throw new BadRequestException({
        code: ApiErrorCode.CLOUD_PRINTER_SERIAL_INVALID,
        message: 'serialNumber is invalid',
      });
    }
    if (displayName === null) {
      throw new BadRequestException({
        code: ApiErrorCode.CLOUD_PRINTER_NAME_INVALID,
        message: 'displayName is invalid',
      });
    }
    if (!request.operationPassword) {
      throw new BadRequestException({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
        message: 'operationPassword is required',
      });
    }
    return {
      serialNumber,
      displayName,
      operationPassword: request.operationPassword,
    };
  }

  private normalizeConfirmInput(request: ConfirmCloudPrinterRequest): {
    challengeId: string;
    code: string;
    operationPassword: string;
  } {
    if (!request.operationPassword) {
      throw new BadRequestException({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
        message: 'operationPassword is required',
      });
    }
    if (!/^\d{6}$/u.test(request.code)) {
      throw new BadRequestException({
        code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
        message: 'code must contain exactly six digits',
      });
    }
    return {
      challengeId: request.challengeId,
      code: request.code,
      operationPassword: request.operationPassword,
    };
  }

  private assertIdempotencyKey(key: string): void {
    if (!key) {
      throw new BadRequestException({
        code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
        message: 'Idempotency-Key header is required',
      });
    }
  }

  private async withDeadlockRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
        if (code !== 'ER_LOCK_DEADLOCK' || attempt >= 2) throw error;
      }
    }
  }

  private isRecoverableIdempotencyError(error: unknown): boolean {
    const code = apiCodeOf(error);
    return (
      code === ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN ||
      code === ApiErrorCode.IDEMPOTENCY_IN_PROGRESS
    );
  }

  private projectResult<T>(result: T): Promise<T> {
    return projectCloudPrinterResult(result, this.currentPrinters);
  }

  private async recordAudit(
    manager: EntityManager,
    adminId: string,
    printerId: string,
    action: string,
    changeSummary: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.audit.record(
      {
        actor: { type: 'ADMIN', adminUserId: adminId },
        targetEntity: 'cloud_printers',
        targetId: printerId,
        action,
        changeSummary,
      },
      manager,
    );
  }

  private cloudPrinterRepository(): Repository<CloudPrinter> {
    return this.dataSource.getRepository(CloudPrinter);
  }
}

export {
  normalizeCloudPrinterSnapshot,
  toSnapshotView,
  toView,
} from './cloud-printer-view.js';

void AdminOperationIdempotency;
