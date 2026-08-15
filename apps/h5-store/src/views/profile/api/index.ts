import type {
  UpdateOrderContactPhoneRequest,
  UpdateOrderContactPhoneResponse,
} from '@bake-mall/contracts';

import { customerApi } from '../../../api/customer.js';

export const profileFeatureApi = {
  get: () => customerApi.getMe(),
  updateOrderContactPhone: (
    body: UpdateOrderContactPhoneRequest,
  ): Promise<UpdateOrderContactPhoneResponse> =>
    customerApi.updateOrderContactPhone(body),
};
