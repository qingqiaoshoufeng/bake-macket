import {
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { printingDevicesApi } from './api/index.js';
import PrintingDevicesView from './PrintingDevicesView.vue';

vi.mock('./api/index.js', () => ({
  printingDevicesApi: {
    list: vi.fn(),
    bind: vi.fn(),
    confirm: vi.fn(),
    resend: vi.fn(),
    refresh: vi.fn(),
    requery: vi.fn(),
    confirmDeletion: vi.fn(),
    unbind: vi.fn(),
    rename: vi.fn(),
  },
}));

const api = vi.mocked(printingDevicesApi);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  window.sessionStorage.clear();
  api.list.mockResolvedValue({
    items: [
      {
        id: '1001',
        displayName: '前台出单机',
        serialNumberMasked: 'SN****01',
        status: CloudPrinterStatus.ACTIVE,
        onlineStatus: CloudPrinterOnlineStatus.ONLINE,
        lastStatusCheckedAt: '2026-08-09T10:00:00.000Z',
        bindingStage: PrinterBindingStage.NONE,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
});

describe('PrintingDevicesView', () => {
  it('renders the anime-light admin hierarchy and loads the real list', async () => {
    const wrapper = mount(PrintingDevicesView, {
      global: { directives: { loading: () => undefined } },
    });
    await flushPromises();

    expect(api.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-page-header').exists()).toBe(true);
    expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
    expect(wrapper.text()).toContain('前台出单机');
    expect(wrapper.text()).toContain('绑定打印机');
    expect(wrapper.find('[data-printer-action="unbind"]').exists()).toBe(true);
  });

  it('contains no fetch, store, or router imports in presentational components', async () => {
    const sources = import.meta.glob('./components/*.vue', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>;

    expect(Object.keys(sources)).toHaveLength(5);
    Object.values(sources).forEach((source) => {
      expect(source).not.toMatch(/\bfetch\s*\(/u);
      expect(source).not.toMatch(/stores\//u);
      expect(source).not.toMatch(/vue-router/u);
    });
  });

  it('composes unbind through the feature API and keeps components fetch-free', () => {
    const sources = import.meta.glob('./**/*.{ts,vue}', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>;
    const executable = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.spec.ts'))
      .map(([, source]) => source)
      .join('\n');

    expect(executable).toContain('/unbind');
    expect(executable).toContain("operation: 'unbind'");
    expect(executable).not.toMatch(/components[\\/].*\bfetch\s*\(/u);
  });
});
