import { FulfillmentType } from '@bake-mall/contracts';

import type { CheckoutFormValues } from '../type/index.js';

export const checkoutFormMock: Readonly<CheckoutFormValues> = {
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '小明',
  contactPhone: '13800000000',
  pickupTimeText: '明天上午十点',
  addressId: null,
  remark: '请写生日快乐',
};
