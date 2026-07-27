import type { DeepReadonly } from 'vue';
import type {
  MemberCreditEntryView,
  MembershipOverviewView,
  MembershipPurchaseView,
  PublicMembershipLevelView,
} from '@bake-mall/contracts';

export type MembershipPurchaseAction =
  'purchase' | 'renew' | 'upgrade' | 'blocked' | 'unavailable';

export type MembershipPurchaseCapability = {
  readonly action: MembershipPurchaseAction;
  readonly allowed: boolean;
  readonly label: string;
  readonly description: string;
};

export type MembershipOverviewModel = DeepReadonly<MembershipOverviewView>;
export type MembershipLevelModel = DeepReadonly<PublicMembershipLevelView>;
export type MembershipDisplayLevel = Omit<
  MembershipLevelModel,
  'priceCents' | 'grantCreditCents' | 'validDays' | 'sortOrder'
> & {
  readonly priceCents: number | null;
  readonly grantCreditCents: number | null;
  readonly validDays: number | null;
  readonly sortOrder: number | null;
};

export type MembershipCarouselItem = {
  readonly level: MembershipDisplayLevel;
  readonly capability: MembershipPurchaseCapability;
  readonly isCurrent: boolean;
  readonly purchasable: boolean;
};

export type MembershipPurchaseState =
  | { readonly kind: 'idle'; readonly purchase: null; readonly message: null }
  | {
      readonly kind: 'pending';
      readonly purchase: MembershipPurchaseView;
      readonly message: string;
    }
  | {
      readonly kind: 'fulfilled';
      readonly purchase: MembershipPurchaseView;
      readonly message: string;
    }
  | {
      readonly kind: 'failed';
      readonly purchase: MembershipPurchaseView | null;
      readonly message: string;
    };

export type MembershipCenterSnapshot = {
  readonly overview: MembershipOverviewView;
  readonly purchases: readonly MembershipPurchaseView[];
  readonly creditEntries: readonly MemberCreditEntryView[];
};
