import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

async function read(relativePath: string): Promise<string> {
  return readFile(`${packageRoot}/${relativePath}`, 'utf8');
}

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

  it('renders the management entry as a cover-view over the web-view', async () => {
    const indexPage = await read('pages/index/index.wxml');

    expect(indexPage).toMatch(
      /<web-view[\s\S]*<cover-view[\s\S]*bindtap="onEnterAdmin"[\s\S]*>门店管理<\/cover-view>[\s\S]*<\/web-view>/u,
    );
    expect(indexPage).not.toMatch(/<button[\s\S]*class="admin-entry"/u);
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

  it('wires UNKNOWN, FAILED and MANUAL_REVIEW recovery actions on printing jobs', async () => {
    const sources = await Promise.all([
      read('admin/api/printing-orders.ts'),
      read('admin/hooks/printing-orders.ts'),
      read('pages/admin-printing/index.ts'),
      read('pages/admin-printing/index.wxml'),
    ]);
    const source = sources.join('\n');

    expect(source).toContain('/query-unknown');
    expect(source).toContain('/retry-failed');
    expect(source).toContain('/manual-resolution');
    expect(source).toContain('RETRY_WITH_DUPLICATE_RISK');
    expect(source).toContain('可能重复出纸');
  });

  it('renders all three password fields for initial and current modes', async () => {
    const passwordPage = await read('pages/admin-password/index.wxml');

    expect(passwordPage).toContain('currentPassword');
    expect(passwordPage).toContain('newPassword');
    expect(passwordPage).toContain('confirmPassword');
    expect(passwordPage).toContain('mode');
  });
});
