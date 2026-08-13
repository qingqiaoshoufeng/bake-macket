import type {
  AppendPrintBatchResult,
  CancelPrintBatchResult,
  CreatePrintBatchResult,
  CreateSinglePrintResult,
  FailedPrintRetryResult,
  ManualPrintResolutionResult,
  PrintJobListResult,
  ProcessPrintBatchResult,
  QueryUnknownPrintJobResult,
  SealPrintBatchResult,
} from '@bake-mall/contracts';
import { AdminPermission } from '@bake-mall/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminPermissionGuard } from '../auth/admin-permission.guard.js';
import { RequireAdminPermissions } from '../auth/admin-permission.decorator.js';
import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import { CanonicalUnsignedBigIntIdPipe } from '../common/canonical-unsigned-bigint-id.pipe.js';
import {
  AppendPrintBatchDto,
  CreatePrintBatchDto,
  CreateSinglePrintDto,
  EmptyPrintingOperationDto,
  FailedPrintRetryDto,
  ManualPrintResolutionDto,
} from './dto/print-job.dto.js';
import { PrintJobListQueryDto } from './dto/print-job-list-query.dto.js';
import { PrintBatchService } from './print-batch.service.js';
import { PrintJobService } from './print-job.service.js';
import { PrintRecoveryService } from './print-recovery.service.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  requirePrintingIdempotencyKey,
} from './printing-http.js';

@Controller('admin/print-jobs')
@UseGuards(JwtAdminGuard, AdminPermissionGuard)
export class AdminPrintJobsController {
  constructor(
    private readonly batches: PrintBatchService,
    private readonly recovery: PrintRecoveryService,
    private readonly jobs: PrintJobService,
  ) {}

  @Get()
  @RequireAdminPermissions(AdminPermission.PRINT_EXECUTE)
  list(@Query() query: PrintJobListQueryDto): Promise<PrintJobListResult> {
    return this.jobs.list(query);
  }

  @Post('single')
  @HttpCode(HttpStatus.CREATED)
  @RequireAdminPermissions(AdminPermission.PRINT_EXECUTE)
  async createSingle(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: CreateSinglePrintDto,
  ): Promise<CreateSinglePrintResult> {
    return this.batches.createSingle(
      admin,
      body,
      requirePrintingIdempotencyKey(idempotencyKey),
    );
  }

  @Post('batches')
  @HttpCode(HttpStatus.CREATED)
  @RequireAdminPermissions(AdminPermission.PRINT_EXECUTE)
  async createBatch(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: CreatePrintBatchDto,
  ): Promise<CreatePrintBatchResult> {
    return this.batches.create(
      admin,
      body,
      requirePrintingIdempotencyKey(idempotencyKey),
    );
  }

  @Post('batches/:id/jobs')
  @RequireAdminPermissions(AdminPermission.PRINT_EXECUTE)
  async appendBatch(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Param('id', CanonicalUnsignedBigIntIdPipe) batchId: string,
    @Body() body: AppendPrintBatchDto,
  ): Promise<AppendPrintBatchResult> {
    return this.batches.append(
      admin,
      batchId,
      body,
      requirePrintingIdempotencyKey(idempotencyKey),
    );
  }

  @Post('batches/:id/seal')
  @RequireAdminPermissions(AdminPermission.PRINT_EXECUTE)
  async sealBatch(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Param('id', CanonicalUnsignedBigIntIdPipe) batchId: string,
    @Body() body: EmptyPrintingOperationDto,
  ): Promise<SealPrintBatchResult> {
    void body;
    return this.batches.seal(
      admin,
      batchId,
      requirePrintingIdempotencyKey(idempotencyKey),
    );
  }

  @Post(':id/query-unknown')
  @RequireAdminPermissions(AdminPermission.PRINT_EXECUTE)
  async queryUnknown(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Param('id', CanonicalUnsignedBigIntIdPipe) jobId: string,
    @Body() body: EmptyPrintingOperationDto,
  ): Promise<QueryUnknownPrintJobResult> {
    void body;
    return this.recovery.queryUnknown(
      admin,
      jobId,
      requirePrintingIdempotencyKey(idempotencyKey),
    );
  }

  @Post(':id/retry-failed')
  @RequireAdminPermissions(AdminPermission.PRINT_EXECUTE)
  async retryFailed(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Param('id', CanonicalUnsignedBigIntIdPipe) jobId: string,
    @Body() body: FailedPrintRetryDto,
  ): Promise<FailedPrintRetryResult> {
    const key = requirePrintingIdempotencyKey(idempotencyKey);
    return this.recovery.retryFailed(admin, jobId, body, key);
  }

  @Post(':id/manual-resolution')
  @RequireAdminPermissions(AdminPermission.PRINT_EXECUTE)
  async resolveManual(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Param('id', CanonicalUnsignedBigIntIdPipe) jobId: string,
    @Body() body: ManualPrintResolutionDto,
  ): Promise<ManualPrintResolutionResult> {
    if (body.resolution === 'RETRY_WITH_DUPLICATE_RISK') {
      return this.recovery.resolveManualRetry(
        admin,
        jobId,
        {
          resolution: body.resolution,
          printerId: body.printerId!,
          confirmDuplicateRisk: body.confirmDuplicateRisk!,
        },
        requirePrintingIdempotencyKey(idempotencyKey),
      );
    }
    return this.recovery.resolveManual(
      admin,
      jobId,
      { resolution: body.resolution },
      requirePrintingIdempotencyKey(idempotencyKey),
    );
  }

  @Post('batches/:id/cancel')
  @RequireAdminPermissions(AdminPermission.PRINT_EXECUTE)
  async cancelBatch(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Param('id', CanonicalUnsignedBigIntIdPipe) batchId: string,
    @Body() body: EmptyPrintingOperationDto,
  ): Promise<CancelPrintBatchResult> {
    void body;
    return this.batches.cancel(
      admin,
      batchId,
      requirePrintingIdempotencyKey(idempotencyKey),
    );
  }

  @Post('batches/:id/process')
  @RequireAdminPermissions(AdminPermission.PRINT_EXECUTE)
  async processBatch(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Param('id', CanonicalUnsignedBigIntIdPipe) batchId: string,
    @Body() body: EmptyPrintingOperationDto,
  ): Promise<ProcessPrintBatchResult> {
    void body;
    return this.batches.process(
      admin,
      batchId,
      requirePrintingIdempotencyKey(idempotencyKey),
    );
  }
}
