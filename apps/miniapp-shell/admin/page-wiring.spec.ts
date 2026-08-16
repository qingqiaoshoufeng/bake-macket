import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

async function read(relativePath: string): Promise<string> {
  return readFile(`${packageRoot}/${relativePath}`, 'utf8');
}

describe('native WeChat login page wiring', () => {
  it('registers an explicit login page that does not request a phone number', async () => {
    const [appSource, template, controller] = await Promise.all([
      read('app.json'),
      read('pages/wechat-login/index.wxml'),
      read('pages/wechat-login/index.ts'),
    ]);
    const app = JSON.parse(appSource) as { pages: string[] };

    expect(app.pages).toContain('pages/wechat-login/index');
    expect(template).toContain('bindtap="onWechatLogin"');
    expect(template).not.toContain('getPhoneNumber');
    expect(controller).toContain('login: freshWechatLogin');
    expect(controller).toMatch(
      /async onWechatLogin\(\)[\s\S]*controller\.handleLogin\(\)/u,
    );
    expect(controller).not.toMatch(/Storage|console\./u);
  });
});

describe('Task 7 native admin page wiring', () => {
  it('registers all native admin pages and the real user-list component', async () => {
    const app = JSON.parse(await read('app.json')) as { pages: string[] };
    const usersPage = JSON.parse(
      await read('pages/admin-users/index.json'),
    ) as { usingComponents?: Record<string, string> };

    expect(app.pages).toEqual(
      expect.arrayContaining([
        'pages/admin-home/index',
        'pages/admin-password/index',
        'pages/admin-users/index',
        'pages/admin-printing/index',
      ]),
    );
    expect(usersPage.usingComponents).toEqual({
      'user-list': '../../admin/components/user-list/index',
    });
    await expect(
      read('admin/components/user-list/index.ts'),
    ).resolves.toContain('Component');
    await expect(
      read('admin/components/user-list/index.wxml'),
    ).resolves.toContain('wx:for');
    await expect(
      read('admin/components/user-list/index.wxss'),
    ).resolves.toBeTruthy();
  });

  it('uses a native modal for the management entry instead of covering web-view', async () => {
    const [indexPage, indexController] = await Promise.all([
      read('pages/index/index.wxml'),
      read('pages/index/index.ts'),
    ]);

    expect(indexPage).toContain('<web-view');
    expect(indexPage).not.toContain('class="admin-entry"');
    expect(indexController).toContain('wx.showModal({');
    expect(indexController).toContain("confirmText: '进入管理'");
    expect(indexController).toMatch(
      /if \(eligible && \(await confirmAdminEntry\(\)\)\)[\s\S]*await this\.onEnterAdmin\(\)/u,
    );
  });

  it('keeps admin flow independent from getPhoneNumber and phone-auth routing', async () => {
    const [authHook, adminApi, navigation, phonePage] = await Promise.all([
      read('admin/hooks/admin-auth.ts'),
      read('admin/api/index.ts'),
      read('admin/config/navigation.ts'),
      read('pages/phone-auth/index.ts'),
    ]);
    const adminSource = [authHook, adminApi, navigation].join('\n');

    expect(adminSource).not.toMatch(
      /phoneVerified|bindWechatPhone|authorizePhone|flow=admin|ADMIN_ROUTES\.phone/u,
    );
    expect(phonePage).not.toContain("query.flow === 'admin'");
    expect(phonePage).not.toContain('createAdminAuthController');
    expect(phonePage).toContain('createPhoneAuthController');
  });

  it('keeps operator UI free of role grant and revoke controls', async () => {
    const sources = await Promise.all([
      read('pages/admin-home/index.wxml'),
      read('pages/admin-users/index.wxml'),
      read('admin/components/user-list/index.wxml'),
    ]);

    expect(sources.join('\n')).not.toMatch(
      /grant|revoke|授权操作员|撤销操作员/u,
    );
  });

  it('shows each user creation time', async () => {
    const userList = await read('admin/components/user-list/index.wxml');

    expect(userList).toContain('item.createdAt');
  });

  it('redirects every ordinary admin page before work when initial password change is required', async () => {
    const ordinaryPages = await Promise.all([
      read('pages/admin-home/index.ts'),
      read('pages/admin-users/index.ts'),
      read('pages/admin-printing/index.ts'),
    ]);

    ordinaryPages.forEach((source) => {
      const gate = source.indexOf('session.mustChangePassword');
      const redirect = source.indexOf(
        "wx.redirectTo({ url: '/pages/admin-password/index' })",
      );
      const pageWork = Math.max(
        source.indexOf('this.setData({', redirect),
        source.indexOf('await this.onRetry()', redirect),
      );

      expect(gate).toBeGreaterThan(-1);
      expect(redirect).toBeGreaterThan(gate);
      expect(source.indexOf('return;', redirect)).toBeGreaterThan(redirect);
      expect(pageWork).toBeGreaterThan(redirect);
    });
  });

  it('wires current-printer selection and all print recovery actions', async () => {
    const sources = await Promise.all([
      read('admin/api/printing-orders.ts'),
      read('admin/hooks/printing-orders.ts'),
      read('pages/admin-printing/index.ts'),
      read('pages/admin-printing/index.wxml'),
    ]);
    const source = sources.join('\n');

    expect(source).toContain('/admin/cloud-printers/current');
    expect(source).toContain('/query-unknown');
    expect(source).toContain('/retry-failed');
    expect(source).toContain('/manual-resolution');
    expect(source).toContain('RETRY_WITH_DUPLICATE_RISK');
    expect(source).toContain('可能重复出纸');
    expect(source).toContain('当前设备');
    expect(source).toContain('不可用');
    expect(source).toContain('selectedPrinterLabel');
    expect(source).toContain('createPrintIntent');
    expect(source).toContain('syncPageAndHandleSession');
    expect(source).toContain('pendingBatchPrinterLabel');
    expect(source).toMatch(
      /确认打印订单[\s\S]*selectedPrinterLabel|selectedPrinterLabel[\s\S]*确认打印订单/u,
    );
  });

  it('renders all three password fields for initial and current modes', async () => {
    const passwordPage = await read('pages/admin-password/index.wxml');

    expect(passwordPage).toContain('currentPassword');
    expect(passwordPage).toContain('newPassword');
    expect(passwordPage).toContain('confirmPassword');
    expect(passwordPage).toContain('mode');
  });
});
