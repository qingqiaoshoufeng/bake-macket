import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SanitizedHtmlPreview from './SanitizedHtmlPreview.vue';

describe('SanitizedHtmlPreview', () => {
  it('renders allowed rich text while removing executable server markup', () => {
    const wrapper = mount(SanitizedHtmlPreview, {
      props: {
        html: '<p onclick="alert(1)">安全预览</p><script>alert(1)</script><a href="javascript:alert(1)">坏链接</a><img src="https://cdn.example.com/a.webp" onerror="alert(1)">',
      },
    });

    expect(wrapper.html()).toContain('<p>安全预览</p>');
    expect(wrapper.html()).toContain('<a>坏链接</a>');
    expect(wrapper.html()).toContain(
      '<img src="https://cdn.example.com/a.webp">',
    );
    expect(wrapper.html()).not.toContain('onclick');
    expect(wrapper.html()).not.toContain('onerror');
    expect(wrapper.html()).not.toContain('<script');
    expect(wrapper.html()).not.toContain('javascript:');
  });

  it('reactively sanitizes replacement HTML', async () => {
    const wrapper = mount(SanitizedHtmlPreview, {
      props: { html: '<p>初始内容</p>' },
    });

    await wrapper.setProps({
      html: '<p>新内容</p><img src="data:image/svg+xml;base64,x">',
    });

    expect(wrapper.html()).toContain('<p>新内容</p><img>');
    expect(wrapper.html()).not.toContain('data:image');
  });
});
