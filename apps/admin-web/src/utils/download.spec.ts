import { afterEach, describe, expect, it, vi } from 'vitest';

import { safeDownloadFilename, saveBlob } from './download.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('safeDownloadFilename', () => {
  it.each([
    ['orders.xlsx', 'orders.xlsx'],
    ['../orders.xlsx', undefined],
    ['..\\orders.xlsx', undefined],
    [`orders${String.fromCharCode(10)}.xlsx`, undefined],
    ['', undefined],
  ])('maps %j to a safe filename', (filename, expected) => {
    expect(safeDownloadFilename(filename)).toBe(expected);
  });
});

describe('saveBlob', () => {
  it('clicks a temporary download anchor and always revokes its object URL', () => {
    const blob = new Blob(['orders'], { type: 'text/csv' });
    const createObjectURL = vi.fn().mockReturnValue('blob:orders');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchor = document.createElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const remove = vi.spyOn(anchor, 'remove');
    const append = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation((node) => node);
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    saveBlob(blob, 'orders.xlsx');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe('blob:orders');
    expect(anchor.download).toBe('orders.xlsx');
    expect(append).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:orders');
  });

  it('rejects an unsafe filename before creating an object URL', () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

    expect(() => saveBlob(new Blob(['orders']), '../orders.xlsx')).toThrow(
      '下载文件名不安全',
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('removes the anchor and revokes the object URL when click throws', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:orders');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchor = document.createElement('a');
    vi.spyOn(anchor, 'click').mockImplementation(() => {
      throw new Error('click failed');
    });
    const remove = vi.spyOn(anchor, 'remove');
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    expect(() => saveBlob(new Blob(['orders']), 'orders.xlsx')).toThrow(
      'click failed',
    );
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:orders');
  });

  it('throws a clear error when browser download APIs are unavailable', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('URL', undefined);

    expect(() => saveBlob(new Blob(['orders']), 'orders.xlsx')).toThrow(
      '当前环境不支持浏览器文件下载',
    );
  });
});
