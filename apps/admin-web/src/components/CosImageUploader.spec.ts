import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { performUpload } from '../api/upload.js';
import CosImageUploader from './CosImageUploader.vue';

vi.mock('../api/upload.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/upload.js')>();
  return { ...actual, performUpload: vi.fn() };
});

const originalAsset = {
  objectKey: 'products/original.webp',
  publicUrl: 'http://127.0.0.1:9000/bake-mall/products/original.webp',
};
const uploadedAsset = {
  objectKey: 'products/a.webp',
  publicUrl: 'http://127.0.0.1:9000/bake-mall/products/a.webp',
};

function selectFile(
  wrapper: ReturnType<typeof mount>,
  file: File,
): Promise<void> {
  const input = wrapper.get('[data-testid="cos-upload-input"]');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [file],
  });
  return input.trigger('change');
}

describe('CosImageUploader', () => {
  beforeEach(() => {
    vi.mocked(performUpload).mockReset();
  });

  it('emits the complete MediaAsset after upload and null when cleared', async () => {
    vi.mocked(performUpload).mockResolvedValue({
      ...uploadedAsset,
      uploadUrl: 'http://127.0.0.1:9000/bake-mall',
      fields: {},
      expiresAt: '2026-07-18T00:00:00.000Z',
    });
    const wrapper = mount(CosImageUploader, {
      props: { scope: 'products', modelValue: originalAsset },
    });

    await selectFile(
      wrapper,
      new File(['image'], 'a.webp', { type: 'image/webp' }),
    );
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(
      uploadedAsset,
    );
    expect(wrapper.emitted('uploading-change')).toEqual([[true], [false]]);

    await wrapper.get('[data-testid="clear-image"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBeNull();
  });

  it('preserves the original MediaAsset and always ends uploading after failure', async () => {
    vi.mocked(performUpload).mockRejectedValue(new Error('storage offline'));
    const wrapper = mount(CosImageUploader, {
      props: { scope: 'products', modelValue: originalAsset },
    });

    await selectFile(
      wrapper,
      new File(['image'], 'a.webp', { type: 'image/webp' }),
    );
    await flushPromises();

    expect(wrapper.get('img').attributes('src')).toBe(originalAsset.publicUrl);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('uploading-change')).toEqual([[true], [false]]);
  });
});
