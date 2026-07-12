import { FulfillmentType, OrderStatus } from './enums.js';

type CreateOrderRequestCommon = {
  cartItemIds: string[];
  contactName: string;
  contactPhone: string;
  remark?: string;
};

export type CreateOrderRequest = CreateOrderRequestCommon &
  (
    | {
        fulfillmentType: FulfillmentType.PICKUP;
        pickupTimeText: string;
        addressId?: never;
      }
    | {
        fulfillmentType: FulfillmentType.DELIVERY;
        addressId: string;
        pickupTimeText?: never;
      }
  );

export type OrderItemView = {
  id: string;
  productName: string;
  skuName: string;
  skuAttributes: Record<string, string>;
  imageUrl?: string;
  unitPriceCents: number;
  quantity: number;
};

export type OrderView = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  contactName: string;
  contactPhone: string;
  pickupTimeText?: string;
  deliveryAddressText?: string;
  goodsTotalCents: number;
  remark?: string;
  items: OrderItemView[];
  createdAt: string;
  updatedAt: string;
};

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  if (from === OrderStatus.NEW && to === OrderStatus.PROCESSING) {
    return true;
  }
  if (
    from === OrderStatus.PROCESSING &&
    (to === OrderStatus.COMPLETED || to === OrderStatus.CANCELLED)
  ) {
    return true;
  }
  return false;
}

// Type-level assertions: invalid variants must fail typecheck.
const _validPickup: CreateOrderRequest = {
  cartItemIds: ['cart-item-1'],
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: 'Alice',
  contactPhone: '13800000000',
  pickupTimeText: 'tomorrow 10am',
};

const _validDelivery: CreateOrderRequest = {
  cartItemIds: ['cart-item-1'],
  fulfillmentType: FulfillmentType.DELIVERY,
  contactName: 'Alice',
  contactPhone: '13800000000',
  addressId: 'address-1',
};

// @ts-expect-error PICKUP must include pickupTimeText.
const _pickupMissingTime: CreateOrderRequest = {
  cartItemIds: ['cart-item-1'],
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: 'Alice',
  contactPhone: '13800000000',
};

// @ts-expect-error PICKUP forbids addressId.
const _pickupWithAddress: CreateOrderRequest = {
  cartItemIds: ['cart-item-1'],
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: 'Alice',
  contactPhone: '13800000000',
  pickupTimeText: 'tomorrow 10am',
  addressId: 'address-1',
};

// @ts-expect-error DELIVERY must include addressId.
const _deliveryMissingAddress: CreateOrderRequest = {
  cartItemIds: ['cart-item-1'],
  fulfillmentType: FulfillmentType.DELIVERY,
  contactName: 'Alice',
  contactPhone: '13800000000',
};

// @ts-expect-error DELIVERY forbids pickupTimeText.
const _deliveryWithPickupTime: CreateOrderRequest = {
  cartItemIds: ['cart-item-1'],
  fulfillmentType: FulfillmentType.DELIVERY,
  contactName: 'Alice',
  contactPhone: '13800000000',
  addressId: 'address-1',
  pickupTimeText: 'tomorrow 10am',
};

void [
  _validPickup,
  _validDelivery,
  _pickupMissingTime,
  _pickupWithAddress,
  _deliveryMissingAddress,
  _deliveryWithPickupTime,
];
