import type {
  BooleanFilter,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';

export type OrderFilterForm = {
  orderNo: string;
  contact: string;
  status: OrderStatus | '';
  fulfillmentType: FulfillmentType | '';
  userId: string;
  itemQ: string;
  usesMembership: BooleanFilter | '';
  usesCredit: BooleanFilter | '';
  hasRemark: BooleanFilter | '';
  minPayableYuan: string;
  maxPayableYuan: string;
  createdAtRange: readonly [Date, Date] | null;
};
