import { describe, expect, it } from 'vitest';

import {
  MemberCreditDirection,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipStatus,
  MembershipTheme,
} from './membership.js';

describe('membership contracts', () => {
  it('exposes stable states for cards, purchases, payments, and credit entries', () => {
    expect(MembershipTheme.CHAMPAGNE).toBe('CHAMPAGNE');
    expect(MembershipStatus.ACTIVE).toBe('ACTIVE');
    expect(MembershipPurchaseStatus.FULFILLED).toBe('FULFILLED');
    expect(MembershipPaymentStatus.SUCCEEDED).toBe('SUCCEEDED');
    expect(MemberCreditDirection.DEBIT).toBe('DEBIT');
  });
});
