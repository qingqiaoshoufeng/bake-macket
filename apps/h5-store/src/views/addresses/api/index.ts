import { customerApi } from '../../../api/customer.js';

export const addressesFeatureApi = {
  list: () => customerApi.listAddresses(),
  create: (body: Parameters<typeof customerApi.createAddress>[0]) =>
    customerApi.createAddress(body),
  update: (
    id: string,
    body: Parameters<typeof customerApi.updateAddress>[1],
  ) => customerApi.updateAddress(id, body),
  setDefault: (id: string) => customerApi.setDefaultAddress(id),
  remove: (id: string) => customerApi.removeAddress(id),
};
