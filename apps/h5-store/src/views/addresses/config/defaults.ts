import type { AddressFormErrors, AddressFormValues } from '../type/index.js';

export const ADDRESS_PHONE_PATTERN = /^1\d{10}$/;
export const ADDRESS_FORM_DEFAULTS: Readonly<AddressFormValues> = {
  receiverName: '',
  phone: '',
  province: '',
  city: '',
  district: '',
  detail: '',
  isDefault: false,
};
export const ADDRESS_ERROR_DEFAULTS: AddressFormErrors = {
  receiverName: null,
  phone: null,
  province: null,
  city: null,
  district: null,
  detail: null,
  isDefault: null,
};
