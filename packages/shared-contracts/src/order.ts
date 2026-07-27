import { FulfillmentType, OrderStatus } from './enums.js';

type CreateOrderRequestCommon = {
  cartItemIds: string[];
  contactName: string;
  contactPhone: string;
  remark?: string;
};

type CreateOrderQuoteIntent = {
  requestedCreditCents: number;
  quoteToken: string;
};

export type CreateOrderRequest = CreateOrderRequestCommon &
  CreateOrderQuoteIntent &
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
  lineGoodsTotalCents: number;
  lineMembershipDiscountCents: number;
  linePayableCents: number;
};

type OrderMembershipSnapshot =
  | {
      membershipId?: never;
      membershipCode?: never;
      membershipName?: never;
      membershipDiscountBasisPoints?: never;
    }
  | {
      membershipId: string;
      membershipCode: string;
      membershipName: string;
      membershipDiscountBasisPoints: number;
    };

export type OrderView = OrderMembershipSnapshot & {
  id: string;
  orderNo: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  contactName: string;
  contactPhone: string;
  pickupTimeText?: string;
  deliveryAddressText?: string;
  goodsTotalCents: number;
  membershipDiscountCents: number;
  creditAppliedCents: number;
  payableTotalCents: number;
  pricingVersion: number;
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
  requestedCreditCents: 0,
  quoteToken: 'signed-quote',
};

const _validDelivery: CreateOrderRequest = {
  cartItemIds: ['cart-item-1'],
  fulfillmentType: FulfillmentType.DELIVERY,
  contactName: 'Alice',
  contactPhone: '13800000000',
  addressId: 'address-1',
  requestedCreditCents: 500,
  quoteToken: 'signed-quote',
};

// @ts-expect-error Every order requires quote intent.
const _pickupWithoutQuote: CreateOrderRequest = {
  cartItemIds: ['cart-item-1'],
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: 'Alice',
  contactPhone: '13800000000',
  pickupTimeText: 'tomorrow 10am',
};

// @ts-expect-error requestedCreditCents requires quoteToken.
const _creditWithoutQuote: CreateOrderRequest = {
  cartItemIds: ['cart-item-1'],
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: 'Alice',
  contactPhone: '13800000000',
  pickupTimeText: 'tomorrow 10am',
  requestedCreditCents: 500,
};

// @ts-expect-error quoteToken requires requestedCreditCents.
const _quoteWithoutCredit: CreateOrderRequest = {
  cartItemIds: ['cart-item-1'],
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: 'Alice',
  contactPhone: '13800000000',
  pickupTimeText: 'tomorrow 10am',
  quoteToken: 'signed-quote',
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
  _pickupWithoutQuote,
  _creditWithoutQuote,
  _quoteWithoutCredit,
  _pickupMissingTime,
  _pickupWithAddress,
  _deliveryMissingAddress,
  _deliveryWithPickupTime,
];
