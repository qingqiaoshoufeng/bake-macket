import { MembershipStatus } from '@bake-mall/contracts';

import type {
  MembershipCarouselItem,
  MembershipDisplayLevel,
  MembershipLevelModel,
  MembershipOverviewModel,
  MembershipPurchaseCapability,
} from '../type/index.js';

const purchaseCapability: MembershipPurchaseCapability = {
  action: 'purchase',
  allowed: true,
  label: '购买',
  description: '开通这张烘焙护照',
};

export function getMembershipPurchaseCapability(
  overview: MembershipOverviewModel,
  level: MembershipLevelModel,
): MembershipPurchaseCapability {
  const current = overview.currentMembership;
  if (!current || current.status !== MembershipStatus.ACTIVE) {
    return purchaseCapability;
  }
  if (level.rank === current.rank) {
    return {
      action: 'renew',
      allowed: true,
      label: '续费',
      description: '延长当前会员有效期',
    };
  }
  if (level.rank > current.rank) {
    return {
      action: 'upgrade',
      allowed: true,
      label: '升级',
      description: '立即升级到更高等级',
    };
  }
  return {
    action: 'blocked',
    allowed: false,
    label: '当前等级更高',
    description: '已有更高等级会员，暂不可购买此卡',
  };
}

const unavailableCapability: MembershipPurchaseCapability = {
  action: 'unavailable',
  allowed: false,
  label: '当前等级已下架',
  description: '当前会员权益仍有效，但此等级暂不可续费',
};

function currentDisplayLevel(
  overview: MembershipOverviewModel,
): MembershipDisplayLevel | null {
  const current = overview.currentMembership;
  if (
    !current ||
    overview.levels.some((level) => level.id === current.levelId)
  ) {
    return null;
  }
  return {
    id: current.levelId,
    code: current.code,
    name: current.name,
    rank: current.rank,
    priceCents: null,
    grantCreditCents: null,
    discountBasisPoints: current.discountBasisPoints,
    validDays: null,
    benefits: current.benefits,
    cardTheme: current.cardTheme,
    sortOrder: null,
  };
}

export function hasMembershipCardContent(
  overview: MembershipOverviewModel,
): boolean {
  return overview.levels.length > 0 || overview.currentMembership !== null;
}

export function createMembershipCarouselItems(
  overview: MembershipOverviewModel,
): MembershipCarouselItem[] {
  const current = overview.currentMembership;
  const sectionRank = (level: MembershipLevelModel): number =>
    !current || level.rank === current.rank
      ? 0
      : level.rank > current.rank
        ? 1
        : 2;
  const sortedLevels = [...overview.levels].sort(
    (left, right) =>
      sectionRank(left) - sectionRank(right) ||
      left.rank - right.rank ||
      left.sortOrder - right.sortOrder,
  );
  const activeItems = sortedLevels.map((level) => ({
    level,
    capability: getMembershipPurchaseCapability(overview, level),
    isCurrent:
      current?.status === MembershipStatus.ACTIVE &&
      level.id === current.levelId,
    purchasable: true,
  }));
  const displayLevel = currentDisplayLevel(overview);
  return displayLevel
    ? [
        {
          level: displayLevel,
          capability: unavailableCapability,
          isCurrent: true,
          purchasable: false,
        },
        ...activeItems,
      ]
    : activeItems;
}
