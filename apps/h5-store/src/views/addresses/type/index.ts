export type {
  AddressView,
  CreateAddressRequest,
  UpdateAddressRequest,
} from '@bake-mall/contracts';

export type AddressFormValues = {
  receiverName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  isDefault: boolean;
};

export type AddressFormErrors = Readonly<
  Record<keyof AddressFormValues, string | null>
>;
