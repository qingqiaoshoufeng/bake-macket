import type { FulfillmentType } from '@bake-mall/contracts';

export type CheckoutFormValues = {
  fulfillmentType: FulfillmentType;
  contactName: string;
  contactPhone: string;
  pickupTimeText: string;
  addressId: string | null;
  remark: string;
};

export type CheckoutValidation =
  { valid: true } | { valid: false; message: string };
