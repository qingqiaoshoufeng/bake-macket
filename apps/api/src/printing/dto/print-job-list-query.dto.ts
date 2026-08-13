import { PrintJobStatus, type PrintJobListQuery } from '@bake-mall/contracts';
import { IsEnum, IsOptional, Matches } from 'class-validator';

import { AdminPageQueryDto } from '../../common/dto/admin-page-query.dto.js';
import { CANONICAL_UNSIGNED_BIGINT } from './printing-dto.constants.js';

export class PrintJobListQueryDto
  extends AdminPageQueryDto
  implements PrintJobListQuery
{
  @IsOptional()
  @Matches(CANONICAL_UNSIGNED_BIGINT)
  batchId?: string;

  @IsOptional()
  @Matches(CANONICAL_UNSIGNED_BIGINT)
  orderId?: string;

  @IsOptional()
  @IsEnum(PrintJobStatus)
  status?: PrintJobStatus;
}
