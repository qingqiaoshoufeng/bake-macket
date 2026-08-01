import {
  HomepageDraftStatus,
  HomepageInternalPage,
  HomepageLinkType,
  type CreateHomepageDraftRequest,
  type HomepageLink,
} from './index.js';

const copied: CreateHomepageDraftRequest = {
  name: '七夕活动',
  mode: 'COPY',
  sourceDraftId: '12',
};

const blank: CreateHomepageDraftRequest = {
  name: '空白方案',
  mode: 'BLANK',
};

// @ts-expect-error COPY 必须指定来源草稿。
const missingSource: CreateHomepageDraftRequest = {
  name: '错误方案',
  mode: 'COPY',
};

// @ts-expect-error BLANK 不允许携带来源草稿。
const blankWithSource: CreateHomepageDraftRequest = {
  name: '错误方案',
  mode: 'BLANK',
  sourceDraftId: '12',
};

const pageLink: HomepageLink = {
  type: HomepageLinkType.PAGE,
  page: HomepageInternalPage.PRODUCTS,
};

// @ts-expect-error NONE 链接不允许目标商品。
const invalidNoneLink: HomepageLink = {
  type: HomepageLinkType.NONE,
  targetId: 'product-1',
};

// @ts-expect-error PAGE 链接不允许目标 ID。
const invalidPageLink: HomepageLink = {
  type: HomepageLinkType.PAGE,
  page: HomepageInternalPage.CART,
  targetId: 'page-1',
};

void [
  HomepageDraftStatus,
  copied,
  blank,
  missingSource,
  blankWithSource,
  pageLink,
  invalidNoneLink,
  invalidPageLink,
];
