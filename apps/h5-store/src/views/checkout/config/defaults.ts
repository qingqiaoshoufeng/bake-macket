import { FulfillmentType } from '@bake-mall/contracts';

import type { CheckoutFormValues } from '../type/index.js';

export const REMARK_MAX_LENGTH = 300;
export const PHONE_PATTERN = /^1\d{10}$/;
export const ORDER_QUOTE_DEBOUNCE_MS = 300;

export const CHECKOUT_DEFAULTS: Readonly<CheckoutFormValues> = {
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '',
  contactPhone: '',
  pickupTimeText: '',
  addressId: null,
  remark: '',
};
