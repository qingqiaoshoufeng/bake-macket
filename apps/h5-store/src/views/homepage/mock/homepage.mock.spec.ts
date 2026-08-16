import {
  HomepageInternalPage,
  HomepageLinkType,
  HomepageSectionType,
} from '@bake-mall/contracts';
import { describe, expect, it } from 'vitest';

import { HOMEPAGE_MOCK } from './homepage.mock.js';

describe('HOMEPAGE_MOCK', () => {
  it('镜像可发布的完整专业首页示例但不作为线上失败回退', () => {
    expect(HOMEPAGE_MOCK.config.hero.slides).toHaveLength(2);
    expect(HOMEPAGE_MOCK.config.hero.slides.map(({ title }) => title)).toEqual([
      '把生日的心意，做成一块蛋糕',
      '午后三点，留给刚出炉的甜',
    ]);
    expect(HOMEPAGE_MOCK.config.customerService).toMatchObject({
      title: '和烘焙师聊聊',
      phone: '400-xxx-xxxx',
      serviceHours: '每日 09:00–20:00（开发示例）',
      wechatQrCode: { imageUrl: expect.stringContaining('/homepage/demo/v1/') },
    });
    expect(HOMEPAGE_MOCK.config.shortcutGrid.layout).toBe(4);
    expect(HOMEPAGE_MOCK.config.shortcutGrid.items).toHaveLength(4);
    expect(HOMEPAGE_MOCK.config.shortcutGrid.items.map(({ link }) => link)).toEqual([
      { type: HomepageLinkType.PAGE, page: HomepageInternalPage.PRODUCTS },
      { type: HomepageLinkType.PAGE, page: HomepageInternalPage.PRODUCTS },
      {
        type: HomepageLinkType.PAGE,
        page: HomepageInternalPage.MEMBERSHIP_CARDS,
      },
      { type: HomepageLinkType.NONE },
    ]);
    expect(HOMEPAGE_MOCK.config.imageBlocks).toHaveLength(2);
    expect(
      HOMEPAGE_MOCK.config.imageBlocks.every(
        ({ type, image, altText }) =>
          type === HomepageSectionType.IMAGE_BLOCK &&
          image.imageUrl.includes('/homepage/demo/v1/') &&
          altText.trim().length > 0,
      ),
    ).toBe(true);
  });
});
