import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AdminPermission,
  ApiErrorCode,
  type BindCloudPrinterResult,
  type CloudPrinterListResult,
  type ConfirmCloudPrinterResult,
  type RefreshCloudPrinterOnlineStatusResult,
  type RenameCloudPrinterResult,
  type RequeryCloudPrinterVendorRelationResult,
  type ConfirmCloudPrinterCompensationDeletionResult,
  type ResendCloudPrinterVerificationResult,
  type UnbindCloudPrinterResult,
} from '@bake-mall/contracts';
import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AdminPermissionGuard } from '../auth/admin-permission.guard.js';
import { RequireAdminPermissions } from '../auth/admin-permission.decorator.js';
import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import { type AuthenticatedAdmin } from '../auth/auth.types.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import { CanonicalUnsignedBigIntIdPipe } from '../common/canonical-unsigned-bigint-id.pipe.js';
import { isCanonicalAdminOperationIdempotencyKey } from './admin-operation-idempotency.service.js';
import { CloudPrinterService } from './cloud-printer.service.js';
import { CloudPrinterReconciliationService } from './cloud-printer-reconciliation.service.js';
import {
  BindCloudPrinterDto,
  CloudPrinterListQueryDto,
} from './dto/bind-cloud-printer.dto.js';
import { ConfirmPrinterCodeDto } from './dto/confirm-printer-code.dto.js';
import { ConfirmCloudPrinterCompensationDeletionDto } from './dto/confirm-cloud-printer-compensation-deletion.dto.js';
import { RenameCloudPrinterDto } from './dto/rename-cloud-printer.dto.js';
import { RequeryCloudPrinterVendorRelationDto } from './dto/requery-cloud-printer-vendor-relation.dto.js';
import { ResendCloudPrinterCodeDto } from './dto/resend-cloud-printer-code.dto.js';
import { UnbindCloudPrinterDto } from './dto/unbind-cloud-printer.dto.js';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

const requireIdempotencyKey = (header: string | undefined): string => {
  if (!isCanonicalAdminOperationIdempotencyKey(header)) {
    throw new BadRequestException({
      code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
      message: 'Idempotency-Key must be a canonical lowercase UUID v4',
    });
  }
  return header;
};

@Controller('admin/cloud-printers')
@UseGuards(JwtAdminGuard, AdminPermissionGuard)
export class AdminCloudPrintersController {
  constructor(
    private readonly cloudPrinters: CloudPrinterService,
    private readonly reconciliation: CloudPrinterReconciliationService,
  ) {}

  @Get()
  @RequireAdminPermissions(AdminPermission.PRINT_DEVICE_MANAGE)
  list(
    @Query() query: CloudPrinterListQueryDto,
  ): Promise<CloudPrinterListResult> {
    return this.cloudPrinters.list({
      page: query.page,
      pageSize: query.pageSize,
      includeUnbound: query.includeUnbound ?? false,
    });
  }

  @Post('bind')
  @RequireAdminPermissions(AdminPermission.PRINT_DEVICE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  bind(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: BindCloudPrinterDto,
  ): Promise<BindCloudPrinterResult> {
    return this.cloudPrinters.bind(
      admin,
      body,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post(':id/verification/confirm')
  @RequireAdminPermissions(AdminPermission.PRINT_DEVICE_MANAGE)
  confirm(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id', CanonicalUnsignedBigIntIdPipe) printerId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: ConfirmPrinterCodeDto,
  ): Promise<ConfirmCloudPrinterResult> {
    if (body.challengeId !== printerId) {
      throw new UnprocessableEntityException({
        code: ApiErrorCode.CLOUD_PRINTER_VERIFICATION_CODE_INVALID,
        message: 'path id and body challengeId must match',
      });
    }
    const key = requireIdempotencyKey(idempotencyKey);
    return this.cloudPrinters.confirm(admin, body, key);
  }

  @Post(':id/verification/resend')
  @RequireAdminPermissions(AdminPermission.PRINT_DEVICE_MANAGE)
  resend(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id', CanonicalUnsignedBigIntIdPipe) printerId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: ResendCloudPrinterCodeDto,
  ): Promise<ResendCloudPrinterVerificationResult> {
    return this.cloudPrinters.resend(
      admin,
      printerId,
      body,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post(':id/online-status/refresh')
  @RequireAdminPermissions(AdminPermission.PRINT_DEVICE_MANAGE)
  refreshOnlineStatus(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id', CanonicalUnsignedBigIntIdPipe) printerId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
  ): Promise<RefreshCloudPrinterOnlineStatusResult> {
    return this.cloudPrinters.refreshStatus(
      admin,
      printerId,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post(':id/vendor-relation/requery')
  @RequireAdminPermissions(AdminPermission.PRINT_DEVICE_MANAGE)
  requery(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id', CanonicalUnsignedBigIntIdPipe) printerId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: RequeryCloudPrinterVendorRelationDto,
  ): Promise<RequeryCloudPrinterVendorRelationResult> {
    return this.reconciliation.requery(
      admin,
      printerId,
      body,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post(':id/compensation-delete/confirm')
  @RequireAdminPermissions(AdminPermission.PRINT_DEVICE_MANAGE)
  confirmDeletion(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id', CanonicalUnsignedBigIntIdPipe) printerId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: ConfirmCloudPrinterCompensationDeletionDto,
  ): Promise<ConfirmCloudPrinterCompensationDeletionResult> {
    return this.reconciliation.confirmDeletion(
      admin,
      printerId,
      body,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post(':id/unbind')
  @RequireAdminPermissions(AdminPermission.PRINT_DEVICE_MANAGE)
  unbind(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id', CanonicalUnsignedBigIntIdPipe) printerId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: UnbindCloudPrinterDto,
  ): Promise<UnbindCloudPrinterResult> {
    return this.cloudPrinters.unbind(
      admin,
      printerId,
      body,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Patch(':id/display-name')
  @RequireAdminPermissions(AdminPermission.PRINT_DEVICE_MANAGE)
  rename(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id', CanonicalUnsignedBigIntIdPipe) printerId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: RenameCloudPrinterDto,
  ): Promise<RenameCloudPrinterResult> {
    return this.cloudPrinters.rename(
      admin,
      printerId,
      body,
      requireIdempotencyKey(idempotencyKey),
    );
  }
}
