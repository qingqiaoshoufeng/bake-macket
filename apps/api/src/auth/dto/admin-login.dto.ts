import { type AdminLoginRequest } from '@bake-mall/contracts';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsString,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

export class SuperAdminLoginDto {
  readonly kind = 'SUPER_ADMIN' as const;
  email!: string;
  password!: string;
}

export class OperatorLoginDto {
  readonly kind = 'OPERATOR' as const;
  phone!: string;
  password!: string;
}

@ValidatorConstraint({ name: 'adminLoginIdentity', async: false })
class AdminLoginIdentityConstraint implements ValidatorConstraintInterface {
  validate(_kind: unknown, args?: ValidationArguments): boolean {
    if (!args) return false;
    const value = args.object as AdminLoginDto;
    return value.kind === 'SUPER_ADMIN'
      ? typeof value.email === 'string' && value.phone === undefined
      : value.kind === 'OPERATOR'
        ? typeof value.phone === 'string' && value.email === undefined
        : false;
  }

  defaultMessage(): string {
    return 'login identity fields must match kind';
  }
}

export class AdminLoginDto {
  @IsIn(['SUPER_ADMIN', 'OPERATOR'])
  @Validate(AdminLoginIdentityConstraint)
  kind!: AdminLoginRequest['kind'];

  @ValidateIf((value: AdminLoginDto) => value.kind === 'SUPER_ADMIN')
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email?: string;

  @ValidateIf((value: AdminLoginDto) => value.kind === 'OPERATOR')
  @IsString()
  phone?: string;

  @IsString()
  password!: string;

  toRequest(): AdminLoginRequest {
    return this.kind === 'SUPER_ADMIN'
      ? {
          kind: 'SUPER_ADMIN',
          email: this.email as string,
          password: this.password,
        }
      : {
          kind: 'OPERATOR',
          phone: this.phone as string,
          password: this.password,
        };
  }
}
