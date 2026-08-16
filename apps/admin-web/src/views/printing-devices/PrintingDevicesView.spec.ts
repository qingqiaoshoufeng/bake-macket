import {
  AdminRole,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  OPERATOR_PERMISSIONS,
  PrinterBindingStage,
  VendorRelationState,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAdminAuthStore } from '../../stores/admin-auth.js';
import { PENDING_DEVICE_OPERATIONS_STORAGE_KEY } from './hooks/usePrintingDevices.js';
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
    detail: vi.fn(),
    current: vi.fn(),
    setCurrent: vi.fn(),
    clearCurrent: vi.fn(),
  },
}));

const api = vi.mocked(printingDevicesApi);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  window.sessionStorage.clear();
  const payload = btoa(JSON.stringify({ sub: '42', aud: 'mall-admin' }));
  useAdminAuthStore().applySession(
    {
      accessToken: `header.${payload}.signature`,
      expiresAt: '2099-01-01T00:00:00.000Z',
      role: AdminRole.OPERATOR,
      permissions: OPERATOR_PERMISSIONS,
      mustChangePassword: false,
    },
    { identifier: 'admin' },
  );
  api.current.mockResolvedValue({
    printer: null,
    revision: 0,
    updatedAt: '2026-08-09T10:00:00.000Z',
  });
  api.detail.mockResolvedValue({
    id: '1001',
    displayName: '前台出单机',
    serialNumberMasked: 'SN****01',
    status: CloudPrinterStatus.ACTIVE,
    onlineStatus: CloudPrinterOnlineStatus.ONLINE,
    lastStatusCheckedAt: '2026-08-09T10:00:00.000Z',
    bindingStage: PrinterBindingStage.NONE,
    vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    isCurrent: true,
  });
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
        isCurrent: true,
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

    expect(api.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      includeUnbound: false,
    });
    expect(api.current).toHaveBeenCalled();
    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-page-header').exists()).toBe(true);
    expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
    expect(wrapper.text()).toContain('前台出单机');
    expect(wrapper.text()).toContain('绑定打印机');
    expect(wrapper.find('[data-printer-action="unbind"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('前台出单机');
    expect(wrapper.text()).toContain('现有设备');
    expect(wrapper.text()).toContain('已移除设备');
    expect(wrapper.text()).toContain('查看详情');
  });

  it.each(['set-current', 'clear-current'] as const)(
    'continues a hydrated off-page %s operation by loading detail and opening the recovery dialog',
    async (operation) => {
      const offPagePrinter = {
        id: '9001',
        displayName: '仓库出单机',
        serialNumberMasked: 'SN****91',
        status: CloudPrinterStatus.ACTIVE,
        onlineStatus: CloudPrinterOnlineStatus.ONLINE,
        lastStatusCheckedAt: '2026-08-09T10:00:00.000Z',
        bindingStage: PrinterBindingStage.NONE,
        vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
        isCurrent: operation === 'clear-current',
      };
      window.sessionStorage.setItem(
        PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
        JSON.stringify({
          adminId: '42',
          pendingDeviceOperations: [
            {
              operation,
              resourceId: offPagePrinter.id,
              idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
              expectedRevision: 3,
            },
          ],
        }),
      );
      api.detail.mockResolvedValueOnce(offPagePrinter);
      const wrapper = mount(PrintingDevicesView, {
        global: { directives: { loading: () => undefined } },
      });
      await flushPromises();

      await wrapper.get('[data-testid="continue-pending-operation"]').trigger('click');
      await flushPromises();

      expect(api.detail).toHaveBeenCalledWith(offPagePrinter.id);
      expect(wrapper.text()).toContain(
        operation === 'set-current' ? '设为当前打印机' : '清除当前打印机',
      );
      expect(wrapper.text()).toContain('仓库出单机');
    },
  );

  it('contains no fetch, store, or router imports in presentational components', async () => {
    const sources = import.meta.glob('./components/*.vue', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>;

    expect(Object.keys(sources)).toHaveLength(6);
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
