import { describe, expect, it } from 'vitest';

import { sanitizeRichTextHtml } from './richTextHtml.js';

describe('sanitizeRichTextHtml', () => {
  it('preserves the shared safe markup contract', () => {
    expect(
      sanitizeRichTextHtml(
        '<p><strong>安全</strong><a href="https://example.com">链接</a><img src="http://127.0.0.1:9000/bake-mall/a.webp" alt="图片"></p>',
      ),
    ).toBe(
      '<p><strong>安全</strong><a href="https://example.com">链接</a><img src="http://127.0.0.1:9000/bake-mall/a.webp" alt="图片"></p>',
    );
  });

  it('removes executable markup and unsupported URL schemes', () => {
    expect(
      sanitizeRichTextHtml(
        '<p onclick="alert(1)">安全</p><script>alert(1)</script><svg onload="alert(1)"></svg><a href="javascript:alert(1)">坏链接</a><img src="data:image/svg+xml;base64,x" onerror="alert(1)">',
      ),
    ).toBe('<p>安全</p><a>坏链接</a><img>');
  });

  it('allows only configured image origins', () => {
    expect(
      sanitizeRichTextHtml(
        '<img src="https://cdn.example.com/a.webp"><img src="http://localhost:9000/a.webp"><img src="http://127.0.0.1:9000/a.webp">',
      ),
    ).toBe(
      '<img src="https://cdn.example.com/a.webp"><img><img src="http://127.0.0.1:9000/a.webp">',
    );
  });
});
