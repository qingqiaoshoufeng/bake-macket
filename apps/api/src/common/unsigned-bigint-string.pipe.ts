import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;
const CANONICAL_UNSIGNED_DECIMAL = /^[1-9]\d*$/;

export const isUnsignedBigIntString = (value: unknown): value is string =>
  typeof value === 'string' &&
  CANONICAL_UNSIGNED_DECIMAL.test(value) &&
  BigInt(value) <= MAX_UNSIGNED_BIGINT;

@Injectable()
export class UnsignedBigIntStringPipe implements PipeTransform<
  unknown,
  string
> {
  transform(value: unknown): string {
    if (!isUnsignedBigIntString(value)) {
      throw new BadRequestException('参数必须是规范的 unsigned BIGINT 字符串');
    }
    return value;
  }
}
