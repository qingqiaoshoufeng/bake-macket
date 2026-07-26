import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import * as addressesFeature from './addresses/index.js';
import * as cartFeature from './cart/index.js';
import StoreTabbar from './catalog/components/StoreTabbar.vue';
import * as checkoutFeature from './checkout/index.js';
import * as loginFeature from './login/index.js';
import * as membershipFeature from './membership/index.js';
import * as ordersFeature from './orders/index.js';
import * as profileFeature from './profile/index.js';

const FEATURE_EXPORTS = [
  [cartFeature, ['CartItemCard', 'CartCheckoutBar', 'useCart']],
  [
    checkoutFeature,
    [
      'CheckoutItems',
      'CheckoutFulfillment',
      'CheckoutContact',
      'CheckoutSubmit',
      'useCheckout',
    ],
  ],
  [
    ordersFeature,
    ['OrderCard', 'OrderSnapshot', 'useOrderList', 'useOrderDetail'],
  ],
  [addressesFeature, ['AddressCard', 'AddressForm', 'useAddresses']],
  [
    profileFeature,
    [
      'ProfileIdentityCard',
      'ProfileAccountInfo',
      'ProfileServiceLinks',
      'ProfileLogoutButton',
      'useProfile',
    ],
  ],
  [
    membershipFeature,
    [
      'MembershipCardCarousel',
      'MembershipCenterView',
      'MembershipDetailView',
      'MembershipPurchaseResultView',
      'useMembershipOverview',
      'useMembershipPurchase',
    ],
  ],
  [loginFeature, ['LoginForm', 'useLogin']],
] as const;

describe('H5 feature module architecture', () => {
  it.each(FEATURE_EXPORTS)(
    'exports its components and hooks',
    (feature, names) => {
      expect(names.every((name) => name in feature)).toBe(true);
    },
  );

  it('keeps StoreTabbar controlled through props and navigate events', async () => {
    const wrapper = mount(StoreTabbar, {
      props: { activePath: '/cart' },
    });

    expect(wrapper.get('[aria-current="page"]').text()).toContain('购物车');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('我的'))
      ?.trigger('click');

    expect(wrapper.emitted('navigate')).toEqual([['/profile']]);
  });
});
