import { describe, expect, it, vi } from 'vitest';

import { createHomepageDraft, createShortcutItem } from './defaults.js';

describe('homepage defaults', () => {
  it('空白草稿保持空白', () => {
    const draft = createHomepageDraft();

    expect(draft.hero.slides).toEqual([]);
    expect(draft.customerService.wechatQrCode).toBeNull();
    expect(draft.imageBlocks).toEqual([]);
    expect(draft.shortcutGrid.items.every(({ label, image }) => !label && image === null)).toBe(
      true,
    );
  });

  it('禁用 native randomUUID 时通过共享 helper 生成 RFC 4122 v4 id', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (target: Uint8Array) => {
        target.set(Uint8Array.from({ length: 16 }, (_, index) => index));
        return target;
      },
    });
    try {
      expect(createShortcutItem().id).toMatch(
        /^shortcut-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
