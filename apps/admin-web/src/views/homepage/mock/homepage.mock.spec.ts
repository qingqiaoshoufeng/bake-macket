import {
  HomepageInternalPage,
  HomepageLinkType,
  HomepageSectionType,
} from '@bake-mall/contracts';
import { describe, expect, it } from 'vitest';

import { HOMEPAGE_PREVIEW_MOCK } from './homepage.mock.js';

describe('HOMEPAGE_PREVIEW_MOCK', () => {
  it('提供完整的柔和日系烘焙专业示例且不改变空白草稿语义', () => {
    expect(HOMEPAGE_PREVIEW_MOCK.hero.slides).toHaveLength(2);
    expect(HOMEPAGE_PREVIEW_MOCK.hero.slides.map(({ title }) => title)).toEqual([
      '把生日的心意，做成一块蛋糕',
      '午后三点，留给刚出炉的甜',
    ]);
    expect(HOMEPAGE_PREVIEW_MOCK.hero.slides.every(({ image, altText }) =>
      Boolean(image?.objectKey.startsWith('homepage/demo/v1/') && altText.trim()),
    )).toBe(true);

    expect(HOMEPAGE_PREVIEW_MOCK.customerService).toMatchObject({
      title: '和烘焙师聊聊',
      phone: '400-xxx-xxxx',
      serviceHours: '每日 09:00–20:00（开发示例）',
      wechatQrCode: {
        objectKey: expect.stringContaining('homepage/demo/v1/'),
      },
    });

    expect(HOMEPAGE_PREVIEW_MOCK.shortcutGrid.layout).toBe(4);
    expect(
      HOMEPAGE_PREVIEW_MOCK.shortcutGrid.items.map(({ label }) => label),
    ).toEqual(['生日蛋糕', '每日面包', '心意礼盒', '联系客服']);
    expect(
      HOMEPAGE_PREVIEW_MOCK.shortcutGrid.items.map(({ link }) => link),
    ).toEqual([
      { type: HomepageLinkType.PAGE, page: HomepageInternalPage.PRODUCTS },
      { type: HomepageLinkType.PAGE, page: HomepageInternalPage.PRODUCTS },
      {
        type: HomepageLinkType.PAGE,
        page: HomepageInternalPage.MEMBERSHIP_CARDS,
      },
      { type: HomepageLinkType.NONE },
    ]);

    expect(HOMEPAGE_PREVIEW_MOCK.imageBlocks).toHaveLength(2);
    expect(
      HOMEPAGE_PREVIEW_MOCK.imageBlocks.every(
        ({ type, image, altText }) =>
          type === HomepageSectionType.IMAGE_BLOCK &&
          Boolean(image?.objectKey.startsWith('homepage/demo/v1/')) &&
          altText.trim().length > 0,
      ),
    ).toBe(true);
  });
});
