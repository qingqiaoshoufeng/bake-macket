import { describe, expect, it } from 'vitest';

import {
  HOMEPAGE_DEMO_ASSET_ROLES,
  loadHomepageDemoFixture,
} from './homepage-demo-fixture.js';

describe('首页专业示例素材 manifest', () => {
  it('逐字节校验授权记录、MIME、尺寸、大小与 SHA256', async () => {
    const fixture = await loadHomepageDemoFixture();

    expect(fixture.manifest.acquiredAt).toBe('2026-08-16');
    expect(fixture.manifest.licenseUrl).toBe('https://unsplash.com/license');
    expect(fixture.assets.map(({ role }) => role)).toEqual(
      HOMEPAGE_DEMO_ASSET_ROLES,
    );
    expect(fixture.assets.every(({ byteLength }) => byteLength < 5 * 1024 * 1024)).toBe(
      true,
    );
    expect(
      fixture.assets.every(
        ({ manifest, detected }) =>
          manifest.mime === detected.mime &&
          manifest.width === detected.width &&
          manifest.height === detected.height &&
          manifest.sha256 === detected.sha256,
      ),
    ).toBe(true);
    expect(
      fixture.assets
        .filter(({ role }) => role.startsWith('hero-'))
        .every(({ detected }) => detected.width === 1500 && detected.height === 2668),
    ).toBe(true);
    expect(
      fixture.assets
        .filter(({ role }) => role.startsWith('shortcut-'))
        .every(({ detected }) => detected.width === 800 && detected.height === 800),
    ).toBe(true);
    expect(
      fixture.assets
        .filter(({ role }) => role.startsWith('block-'))
        .every(({ detected }) => detected.width === 1600 && detected.height === 900),
    ).toBe(true);
    expect(
      fixture.assets
        .filter(({ manifest }) => manifest.source.platform === 'Unsplash')
        .every(({ manifest }) => {
          const { author, pageUrl, photoId, url } = manifest.source;
          return (
            url.startsWith('https://images.unsplash.com/photo-') &&
            Boolean(author?.trim()) &&
            Boolean(pageUrl?.trim()) &&
            Boolean(photoId?.trim()) &&
            ((pageUrl?.endsWith(`/${photoId}`) ?? false) ||
              pageUrl?.endsWith(`-${photoId}`) === true)
          );
        }),
    ).toBe(true);
  });
});
