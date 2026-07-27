import { customerApi } from '../../../api/customer.js';

export const profileFeatureApi = {
  get: () => customerApi.getMe(),
};
