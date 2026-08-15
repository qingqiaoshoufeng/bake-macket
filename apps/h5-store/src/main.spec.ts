import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const bootstrapEvents = vi.hoisted(() => [] as string[]);
const vantStyleImport = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({
  mount: vi.fn(() => bootstrapEvents.push('mount')),
  use: vi.fn(() => app),
}));
const auth = vi.hoisted(() => ({
  applyCustomerSession: vi.fn(),
  clearSession: vi.fn(),
  hydrate: vi.fn(() => bootstrapEvents.push('hydrate')),
}));
const coordinator = vi.hoisted(() => ({
  start: vi.fn(() => bootstrapEvents.push('coordinator')),
  stop: vi.fn(),
  waitForCurrentAttempt: vi.fn(() => Promise.resolve()),
}));
const installMiniappBridge = vi.hoisted(() =>
  vi.fn(() => {
    bootstrapEvents.push('bridge');
    return vi.fn();
  }),
);
const requestMiniappWechatLogin = vi.hoisted(() =>
  vi.fn(() => {
    bootstrapEvents.push('automatic-login');
    return Promise.resolve(false);
  }),
);
const createStoreRouter = vi.hoisted(() => vi.fn(() => ({})));

vi.mock('vue', () => ({ createApp: vi.fn(() => app) }));
vi.mock('./App.vue', () => ({ default: {} }));
vi.mock('./router/index.js', () => ({ createStoreRouter }));
vi.mock('pinia', () => ({ createPinia: vi.fn(() => ({})) }));
vi.mock('./stores/auth.js', () => ({ useAuthStore: vi.fn(() => auth) }));
vi.mock('./api/http.js', () => ({
  apiClient: { onUnauthorized: vi.fn() },
}));
vi.mock('./views/login/index.js', () => ({
  createWechatAuthCoordinator: vi.fn(() => coordinator),
  loginFeatureApi: { loginWithWechatCode: vi.fn() },
}));
vi.mock('./bridge/miniapp.js', () => ({
  installMiniappBridge,
  miniappMessageHub: { publish: vi.fn(), subscribe: vi.fn() },
  requestMiniappWechatLogin,
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

  it('hydrates and starts the coordinator before publishing the URL handoff', async () => {
    const originalHasOwn = Object.hasOwn;
    const originalStructuredClone = globalThis.structuredClone;
    Object.defineProperty(Object, 'hasOwn', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      value: undefined,
    });

    try {
      await import('./main.js');
    } finally {
      Object.defineProperty(Object, 'hasOwn', {
        configurable: true,
        value: originalHasOwn,
      });
      Object.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        value: originalStructuredClone,
      });
    }

    expect(vantStyleImport).toHaveBeenCalledOnce();
    expect(installMiniappBridge).toHaveBeenCalledWith(expect.any(Function), {
      enableWindowMessages: true,
    });
    expect(requestMiniappWechatLogin).toHaveBeenCalledWith(undefined, {
      automatic: true,
    });
    expect(createStoreRouter).toHaveBeenCalledWith({
      waitForCurrentAttempt: coordinator.waitForCurrentAttempt,
    });
    expect(bootstrapEvents).toEqual([
      'hydrate',
      'coordinator',
      'bridge',
      'automatic-login',
      'mount',
    ]);
  });
});
