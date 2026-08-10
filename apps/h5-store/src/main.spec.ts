import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const bootstrapEvents = vi.hoisted(() => [] as string[]);
const vantStyleImport = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({
  mount: vi.fn(() => bootstrapEvents.push('mount')),
  use: vi.fn(() => app),
}));
const installMiniappBridge = vi.hoisted(() =>
  vi.fn(() => {
    bootstrapEvents.push('bridge');
    return vi.fn();
  }),
);

vi.mock('vue', () => ({
  createApp: vi.fn(() => app),
}));
vi.mock('./App.vue', () => ({ default: {} }));
vi.mock('./router/index.js', () => ({ router: {} }));
vi.mock('pinia', () => ({ createPinia: vi.fn(() => ({})) }));
vi.mock('./bridge/miniapp.js', () => ({
  installMiniappBridge,
  miniappMessageHub: { publish: vi.fn() },
}));
vi.mock('vant/lib/index.css', () => {
  vantStyleImport();
  return {};
});

describe('H5 application bootstrap', () => {
  it('does not synchronously load the official WebView JSSDK from HTML', async () => {
    const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');

    expect(html).not.toContain(
      'https://res.wx.qq.com/open/js/jweixin-1.3.2.js',
    );
    expect(html).toContain(
      '<script type="module" src="/src/main.ts"></script>',
    );
  });

  it('gates development window messages and mounts without awaiting JSSDK', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'src/main.ts'),
      'utf8',
    );
    await import('./main.js');

    expect(vantStyleImport).toHaveBeenCalledOnce();
    expect(source).toContain('enableWindowMessages: import.meta.env.DEV');
    expect(installMiniappBridge).toHaveBeenCalledWith(expect.any(Function), {
      enableWindowMessages: true,
    });
    expect(bootstrapEvents).toEqual(['bridge', 'mount']);
  });
});
