import {
  HomepageInternalPage,
  HomepageLinkType,
  type HomepageLink,
} from '@bake-mall/contracts';

const INTERNAL_PAGE_PATHS: Record<HomepageInternalPage, string> = {
  [HomepageInternalPage.PRODUCTS]: '/products',
  [HomepageInternalPage.CART]: '/cart',
  [HomepageInternalPage.ORDERS]: '/orders',
  [HomepageInternalPage.PROFILE]: '/profile',
  [HomepageInternalPage.MEMBERSHIP_CARDS]: '/membership-cards',
};

export function homepageLinkPath(link: HomepageLink): string | null {
  if (link.type === HomepageLinkType.NONE) return null;
  if (link.type === HomepageLinkType.PRODUCT) {
    return `/products/${encodeURIComponent(link.targetId)}`;
  }
  if (link.type === HomepageLinkType.CATEGORY) {
    return `/category/${encodeURIComponent(link.targetId)}`;
  }
  return INTERNAL_PAGE_PATHS[link.page];
}
