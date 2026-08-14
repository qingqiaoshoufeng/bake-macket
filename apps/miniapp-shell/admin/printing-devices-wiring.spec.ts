import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

async function read(relativePath: string): Promise<string> {
  return readFile(`${packageRoot}/${relativePath}`, 'utf8');
}

describe('native printing devices wiring and static safety', () => {
  it('registers page and component through usingComponents', async () => {
    const app = JSON.parse(await read('app.json')) as { pages: string[] };
    const page = JSON.parse(await read('pages/admin-printers/index.json')) as {
      usingComponents?: Record<string, string>;
    };
    const component = JSON.parse(
      await read('admin/components/printer-list/index.json'),
    ) as { component?: boolean };

    expect(app.pages).toContain('pages/admin-printers/index');
    expect(page.usingComponents).toEqual({
      'printer-list': '../../admin/components/printer-list/index',
    });
    expect(component.component).toBe(true);
  });

  it('keeps the component UI-only and uses immutable setData objects', async () => {
    const component = await read('admin/components/printer-list/index.ts');
    const template = await read('admin/components/printer-list/index.wxml');

    expect(component).toContain('Component');
    expect(component).toContain('this.setData({');
    expect(component).not.toMatch(/api|request|wx\.request/u);
    expect(template).toContain('serialNumberMasked');
    expect(template).toContain('onlineStatus');
    expect(template).toContain('离线，不能提交打印任务');
    expect(template).toContain('status');
    expect(template).toContain('action.value');
    expect(`${component}\n${template}`).not.toMatch(/api|request|wx\.request/u);
  });

  it('contains strict page gates, permission navigation, and lifecycle persistence', async () => {
    const page = await read('pages/admin-printers/index.ts');
    const navigation = await read('admin/config/navigation.ts');

    expect(navigation).toContain('PRINT_DEVICE_MANAGE');
    expect(navigation).toContain('/pages/admin-printers/index');
    expect(page).toContain('session.mustChangePassword');
    expect(page).toContain('PRINT_DEVICE_MANAGE');
    expect(page).toContain('app.adminSession.clear()');
    expect(page).toContain('wx.reLaunch');
    expect(page).toContain('onHide');
    expect(page).toContain('onUnload');
    expect(page).toContain('persistLifecycleState');
    expect(page).toContain("pending('refresh', printerId)");
    expect(page).toContain(
      "controller.continueOperation('refresh', printerId)",
    );
    expect(await read('admin/components/printer-list/index.wxml')).toContain(
      'disabled="{{action.disabled}}"',
    );
    const template = await read('pages/admin-printers/index.wxml');
    expect(template).toContain('remainingAttempts <= 0');
    expect(template).toContain('验证码尝试次数已耗尽，请重发验证码');
  });

  it('keeps feature networking on api-client and storage free of forbidden secrets', async () => {
    const api = await read('admin/api/printing-devices.ts');
    const hook = await read('admin/hooks/printing-devices.ts');
    const adminSources = await Promise.all([
      read('admin/api/printing-devices.ts'),
      read('admin/hooks/printing-devices.ts'),
      read('pages/admin-printers/index.ts'),
      read('admin/components/printer-list/index.ts'),
    ]);
    const source = adminSources.join('\n');

    expect(api).toContain('createMiniappApiClient');
    expect(api).not.toContain('wx.request');
    expect(source).not.toContain('wx.request');
    expect(hook).toContain('pendingDeviceOperations');
    expect(hook).toContain('lastPrinterId');
    const persistence = hook.slice(
      hook.indexOf('function persistLifecycleState'),
      hook.indexOf('function clearOperations'),
    );
    expect(persistence).not.toMatch(
      /accessToken|serialNumber|displayName|operationPassword|challengeId|phone|address/u,
    );
  });

  it('wires password-confirmed unbind through API, hook, and page confirmation', async () => {
    const sources = await Promise.all([
      read('admin/api/printing-devices.ts'),
      read('admin/hooks/printing-devices.ts'),
      read('pages/admin-printers/index.ts'),
      read('pages/admin-printers/index.wxml'),
      read('admin/components/printer-list/index.ts'),
      read('admin/components/printer-list/index.wxml'),
    ]);

    const source = sources.join('\n');
    expect(source).toContain('/unbind');
    expect(source).toContain("'unbind'");
    expect(source).toContain('wx.showModal');
  });
});
