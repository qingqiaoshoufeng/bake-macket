export { default as AddressCard } from './components/AddressCard.vue';
export { default as AddressForm } from './components/AddressForm.vue';
export { useAddresses, validateAddress } from './hooks/useAddresses.js';
export { addressesFeatureApi } from './api/index.js';
export type {
  AddressFormErrors,
  AddressFormValues,
  AddressView,
  CreateAddressRequest,
  UpdateAddressRequest,
} from './type/index.js';
