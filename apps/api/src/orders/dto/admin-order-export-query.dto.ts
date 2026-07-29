import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEnum, ValidateBy, type ValidationArguments } from 'class-validator';

import {
  AdminOrderExportView,
  OrderStatus,
  SUPPLY_ORDER_STATUSES,
  type SupplyOrderStatus,
} from '@bake-mall/contracts';

import { AdminOrderFilterDto } from './admin-order-filter.dto.js';

const toOptionalQueryArray = ({ value }: TransformFnParams): unknown =>
  Array.isArray(value) || value === undefined ? value : [value];

const isSupplyStatus = (value: unknown): value is SupplyOrderStatus =>
  SUPPLY_ORDER_STATUSES.includes(value as SupplyOrderStatus);

const hasValidExportStatus = (
  value: unknown,
  { object }: ValidationArguments,
): boolean => {
  const { view } = object as AdminOrderExportQueryDto;
  return view === AdminOrderExportView.ORDER
    ? value === undefined ||
        Object.values(OrderStatus).includes(value as OrderStatus)
    : view === AdminOrderExportView.SUPPLY && value === undefined;
};

const hasValidExportSupplyStatuses = (
  value: unknown,
  { object }: ValidationArguments,
): boolean => {
  const { view } = object as AdminOrderExportQueryDto;
  if (view === AdminOrderExportView.ORDER) return value === undefined;
  if (view !== AdminOrderExportView.SUPPLY || !Array.isArray(value))
    return false;
  return (
    value.length >= 1 &&
    value.length <= 2 &&
    new Set(value).size === value.length &&
    value.every(isSupplyStatus)
  );
};

export class AdminOrderExportQueryDto extends AdminOrderFilterDto {
  @IsEnum(AdminOrderExportView)
  view!: AdminOrderExportView;

  @ValidateBy({
    name: 'isOrderExportStatus',
    validator: {
      validate: hasValidExportStatus,
      defaultMessage: () =>
        'status is only allowed for ORDER exports and must be a valid order status',
    },
  })
  status?: OrderStatus;

  @Transform(toOptionalQueryArray)
  @ValidateBy({
    name: 'isSupplyExportStatuses',
    validator: {
      validate: hasValidExportSupplyStatuses,
      defaultMessage: () =>
        'supplyStatuses is required only for SUPPLY exports and must contain unique NEW/PROCESSING values',
    },
  })
  supplyStatuses?: SupplyOrderStatus[];
}
