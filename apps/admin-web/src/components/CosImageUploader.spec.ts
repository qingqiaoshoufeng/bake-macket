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

function dropFile(
  wrapper: ReturnType<typeof mount>,
  file: File,
): Promise<void> {
  return wrapper.get('[data-testid="cos-upload-drop-area"]').trigger('drop', {
    dataTransfer: { files: [file] },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

  it('renders a quiet compact picker without repeated upload instructions', () => {
    const wrapper = mount(CosImageUploader, {
      props: {
        scope: 'homepage',
        modelValue: null,
        compact: true,
        sceneHint: '建议竖屏 750×1334',
      },
    });

    expect(wrapper.get('.cos-uploader').attributes('data-compact')).toBe(
      'true',
    );
    expect(
      wrapper
        .findAll('button')
        .filter((button) => button.text().trim() === '选择图片'),
    ).toHaveLength(1);
    expect(wrapper.get('.cos-uploader__placeholder').text()).toBe('＋');
    expect(wrapper.text()).toContain('建议竖屏 750×1334');
    expect(wrapper.text()).not.toContain('拖放图片到这里');
    expect(wrapper.text()).not.toContain('点击选择本地文件');
    expect(wrapper.text()).not.toContain('支持 JPEG');
  });

  it('uploads a valid dropped file and closes uploading state', async () => {
    vi.mocked(performUpload).mockResolvedValue({
      ...uploadedAsset,
      uploadUrl: 'http://127.0.0.1:9000/bake-mall',
      fields: {},
      expiresAt: '2026-07-18T00:00:00.000Z',
    });
    const wrapper = mount(CosImageUploader, {
      props: { scope: 'products', modelValue: null },
    });
    const file = new File(['image'], 'drop.webp', { type: 'image/webp' });

    await dropFile(wrapper, file);
    await flushPromises();

    expect(performUpload).toHaveBeenCalledWith(file, 'products');
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(
      uploadedAsset,
    );
    expect(wrapper.emitted('uploading-change')).toEqual([[true], [false]]);
  });

  it.each([
    [
      new File(['text'], 'bad.txt', { type: 'text/plain' }),
      '仅支持 JPEG / PNG / WebP 格式',
    ],
    [
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.webp', {
        type: 'image/webp',
      }),
      '文件大小不能超过 5 MiB',
    ],
  ])(
    'rejects an invalid dropped file without opening upload state',
    async (file, message) => {
      const wrapper = mount(CosImageUploader, {
        props: { scope: 'products', modelValue: originalAsset },
      });

      await dropFile(wrapper, file);
      await flushPromises();

      expect(performUpload).not.toHaveBeenCalled();
      expect(wrapper.get('[role="alert"]').text()).toBe(message);
      expect(wrapper.get('img').attributes('src')).toBe(
        originalAsset.publicUrl,
      );
      expect(wrapper.emitted('uploading-change')).toBeUndefined();
    },
  );

  it('preserves the original MediaAsset and always ends uploading after a dropped upload fails', async () => {
    vi.mocked(performUpload).mockRejectedValue(new Error('storage offline'));
    const wrapper = mount(CosImageUploader, {
      props: { scope: 'products', modelValue: originalAsset },
    });

    await dropFile(
      wrapper,
      new File(['image'], 'a.webp', { type: 'image/webp' }),
    );
    await flushPromises();

    expect(wrapper.get('img').attributes('src')).toBe(originalAsset.publicUrl);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('uploading-change')).toEqual([[true], [false]]);
  });

  it('ignores repeated drops while an upload is in flight', async () => {
    const deferred =
      createDeferred<Awaited<ReturnType<typeof performUpload>>>();
    vi.mocked(performUpload).mockReturnValue(deferred.promise);
    const wrapper = mount(CosImageUploader, {
      props: { scope: 'products', modelValue: null },
    });
    const first = new File(['first'], 'first.webp', { type: 'image/webp' });
    const second = new File(['second'], 'second.webp', { type: 'image/webp' });

    await dropFile(wrapper, first);
    await dropFile(wrapper, second);

    expect(performUpload).toHaveBeenCalledTimes(1);
    expect(performUpload).toHaveBeenCalledWith(first, 'products');

    deferred.resolve({
      ...uploadedAsset,
      uploadUrl: 'http://127.0.0.1:9000/bake-mall',
      fields: {},
      expiresAt: '2026-07-18T00:00:00.000Z',
    });
    await flushPromises();
    expect(wrapper.emitted('uploading-change')).toEqual([[true], [false]]);
  });
});
