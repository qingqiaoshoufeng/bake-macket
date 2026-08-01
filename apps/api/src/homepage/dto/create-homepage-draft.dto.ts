import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

@ValidatorConstraint({ name: 'homepageDraftSource', async: false })
class HomepageDraftSourceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, arguments_: ValidationArguments): boolean {
    const { mode } = arguments_.object as CreateHomepageDraftDto;
    return mode === 'COPY'
      ? typeof value === 'string' && value.trim().length > 0
      : mode === 'BLANK' && value === undefined;
  }

  defaultMessage(): string {
    return 'COPY 模式必须且仅能提供 sourceDraftId';
  }
}

export class CreateHomepageDraftDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsIn(['COPY', 'BLANK'])
  mode!: 'COPY' | 'BLANK';

  @Validate(HomepageDraftSourceConstraint)
  sourceDraftId?: string;
}
