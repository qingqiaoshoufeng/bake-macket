import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import RichTextEditor from './RichTextEditor.vue';

type ClipboardPayload = {
  readonly getData: (type: string) => string;
};

function createClipboardEvent(payload: ClipboardPayload): ClipboardEvent {
  return {
    preventDefault: vi.fn(),
    clipboardData: payload,
  } as unknown as ClipboardEvent;
}

describe('RichTextEditor', () => {
  it('initializes and synchronizes safe HTML as markup instead of text', async () => {
    const wrapper = mount(RichTextEditor, {
      props: { modelValue: '<p><strong>已清洗内容</strong></p>' },
    });

    expect(
      wrapper.get('[data-testid="rich-editor-surface"]').element.innerHTML,
    ).toBe('<p><strong>已清洗内容</strong></p>');
    expect(wrapper.text()).toContain('已清洗内容');
    expect(wrapper.text()).not.toContain('<strong>');

    await wrapper.setProps({ modelValue: '<p><em>服务端新内容</em></p>' });
    expect(
      wrapper.get('[data-testid="rich-editor-surface"]').element.innerHTML,
    ).toBe('<p><em>服务端新内容</em></p>');
  });

  it('never writes unsafe prop HTML into the editable DOM', async () => {
    const wrapper = mount(RichTextEditor, {
      props: {
        modelValue:
          '<p onclick="alert(1)">安全</p><script>alert(1)</script><svg onload="alert(1)"></svg><a href="javascript:alert(1)">坏链接</a><img src="data:image/png;base64,x" onerror="alert(1)">',
      },
    });

    const surface = wrapper.get('[data-testid="rich-editor-surface"]');
    expect(surface.element.innerHTML).toBe('<p>安全</p><a>坏链接</a><img>');

    await wrapper.setProps({
      modelValue: '<p>仍安全</p><img src="https://cdn.example.com/image.webp">',
    });
    expect(surface.element.innerHTML).toBe(
      '<p>仍安全</p><img src="https://cdn.example.com/image.webp">',
    );
  });

  it('sanitizes user input and pasted HTML before emitting it', async () => {
    document.execCommand = vi.fn(() => true);
    const execCommand = vi.mocked(document.execCommand);
    const wrapper = mount(RichTextEditor, { props: { modelValue: '' } });
    const surface = wrapper.get('[data-testid="rich-editor-surface"]');

    surface.element.innerHTML =
      '<p onclick="alert(1)">安全</p><script>alert(1)</script>';
    await surface.trigger('input');
    expect(surface.element.innerHTML).toBe('<p>安全</p>');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      '<p>安全</p>',
    ]);

    await surface.trigger(
      'paste',
      createClipboardEvent({
        getData: (type) =>
          type === 'text/html'
            ? '<img src="data:image/svg+xml;base64,x" onerror="alert(1)"><p>粘贴</p>'
            : '',
      }),
    );
    expect(execCommand).toHaveBeenLastCalledWith(
      'insertHTML',
      false,
      '<img><p>粘贴</p>',
    );
  });

  it('rejects unsafe toolbar URLs and omits unsupported underline control', async () => {
    document.execCommand = vi.fn(() => true);
    const execCommand = vi.mocked(document.execCommand);
    const prompt = vi.spyOn(window, 'prompt');
    const wrapper = mount(RichTextEditor, { props: { modelValue: '' } });

    expect(wrapper.text()).not.toContain('U');
    prompt.mockReturnValueOnce('javascript:alert(1)');
    await wrapper.get('button:nth-last-child(2)').trigger('click');
    prompt.mockReturnValueOnce('http://localhost:9000/image.webp');
    await wrapper.get('button:last-child').trigger('click');
    expect(execCommand).not.toHaveBeenCalled();

    prompt.mockReturnValueOnce('https://example.com');
    await wrapper.get('button:nth-last-child(2)').trigger('click');
    prompt.mockReturnValueOnce('http://127.0.0.1:9000/image.webp');
    await wrapper.get('button:last-child').trigger('click');
    expect(execCommand).toHaveBeenNthCalledWith(
      1,
      'createLink',
      false,
      'https://example.com',
    );
    expect(execCommand).toHaveBeenNthCalledWith(
      2,
      'insertImage',
      false,
      'http://127.0.0.1:9000/image.webp',
    );
    prompt.mockRestore();
  });
});
