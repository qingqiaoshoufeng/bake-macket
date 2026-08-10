import { ApiErrorCode } from '@bake-mall/contracts';
import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

const CANONICAL_UNSIGNED_BIGINT_ID = /^(?:[1-9][0-9]*)$/u;
const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;

@Injectable()
export class CanonicalUnsignedBigIntIdPipe implements PipeTransform<
  unknown,
  string
> {
  transform(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !CANONICAL_UNSIGNED_BIGINT_ID.test(value) ||
      BigInt(value) > MAX_UNSIGNED_BIGINT
    ) {
      throw new BadRequestException({
        code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
        message: 'Cloud printer id must be a canonical unsigned BIGINT',
      });
    }
    return value;
  }
}
