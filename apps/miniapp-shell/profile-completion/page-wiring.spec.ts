import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

function read(relativePath: string): Promise<string> {
  return readFile(`${packageRoot}/${relativePath}`, 'utf8');
}

describe('native profile completion page wiring', () => {
  it('registers the page and wires official avatar and nickname controls', async () => {
    const [appSource, pageTemplate, formTemplate, pageSource] =
      await Promise.all([
        read('app.json'),
        read('pages/profile-completion/index.wxml'),
        read('profile-completion/components/profile-form/index.wxml'),
        read('pages/profile-completion/index.ts'),
      ]);
    const app = JSON.parse(appSource) as { pages: string[] };

    expect(app.pages).toContain('pages/profile-completion/index');
    expect(formTemplate).toContain('open-type="chooseAvatar"');
    expect(formTemplate).toContain('bindchooseavatar="onChooseAvatar"');
    expect(formTemplate).toContain('type="nickname"');
    expect(formTemplate).toContain('maxlength="64"');
    expect(pageTemplate).toContain('bindskip="onSkip"');
    expect(pageSource).toContain('loginWithWechat(code)');
    expect(pageSource).toMatch(/wx\.login[\s\S]*loginWithWechat\(code\)/u);
    expect(pageSource).toContain('handleSystemReturn()');
    expect(pageSource).not.toMatch(/Storage|console\./u);
  });

  it('embeds the same avatar nickname form in the native WeChat login page', async () => {
    const [pageConfig, pageTemplate, pageSource] = await Promise.all([
      read('pages/wechat-login/index.json'),
      read('pages/wechat-login/index.wxml'),
      read('pages/wechat-login/index.ts'),
    ]);

    expect(JSON.parse(pageConfig)).toMatchObject({
      usingComponents: {
        'profile-form':
          '../../profile-completion/components/profile-form/index',
      },
    });
    expect(pageTemplate).toContain('<profile-form');
    expect(pageTemplate).toContain('bindchooseavatar="onChooseAvatar"');
    expect(pageTemplate).toContain('bindnicknamechange="onNicknameChange"');
    expect(pageTemplate).toContain('bindsave="onSave"');
    expect(pageTemplate).toContain('bindskip="onSkip"');
    expect(pageSource).toContain('createWechatLoginProfileController');
    expect(pageSource).toContain('loginWithWechat');
    expect(pageSource).not.toMatch(/wx\.(?:request|uploadFile)/u);
  });
});
