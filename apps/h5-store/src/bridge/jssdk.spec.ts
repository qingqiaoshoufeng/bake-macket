import { afterEach, describe, expect, it, vi } from 'vitest';

const JSSDK_URL = 'https://res.wx.qq.com/open/js/jweixin-1.3.2.js';

async function loadModule() {
  return import('./jssdk.js');
}

function removeJssdkState(): void {
  document
    .querySelectorAll(`script[src="${JSSDK_URL}"]`)
    .forEach((script) => script.remove());
  Reflect.deleteProperty(window, 'wx');
}

afterEach(() => {
  removeJssdkState();
  vi.useRealTimers();
  vi.resetModules();
});

describe('ensureMiniProgramJssdk', () => {
  it('resolves immediately without injecting a script when the SDK already exists', async () => {
    Object.defineProperty(window, 'wx', {
      configurable: true,
      value: { miniProgram: {} },
    });
    const { ensureMiniProgramJssdk } = await loadModule();

    const first = ensureMiniProgramJssdk();
    const second = ensureMiniProgramJssdk();

    expect(first).toBe(second);
    await expect(first).resolves.toBe(true);
    expect(document.querySelector(`script[src="${JSSDK_URL}"]`)).toBeNull();
  });

  it('loads the official SDK dynamically and resolves on load', async () => {
    const { ensureMiniProgramJssdk } = await loadModule();
    const ready = ensureMiniProgramJssdk();
    const script = document.querySelector<HTMLScriptElement>(
      `script[src="${JSSDK_URL}"]`,
    );

    expect(script).not.toBeNull();
    expect(script?.async).toBe(true);
    Object.defineProperty(window, 'wx', {
      configurable: true,
      value: { miniProgram: {} },
    });
    script?.dispatchEvent(new Event('load'));
    await expect(ready).resolves.toBe(true);
  });

  it('resolves false when the official SDK fails to load', async () => {
    const { ensureMiniProgramJssdk } = await loadModule();
    const ready = ensureMiniProgramJssdk();
    const script = document.querySelector<HTMLScriptElement>(
      `script[src="${JSSDK_URL}"]`,
    );

    script?.dispatchEvent(new Event('error'));
    await expect(ready).resolves.toBe(false);
  });

  it('retries with a new script after the first script fails and then succeeds', async () => {
    const { ensureMiniProgramJssdk } = await loadModule();
    const first = ensureMiniProgramJssdk();
    const failedScript = document.querySelector<HTMLScriptElement>(
      `script[src="${JSSDK_URL}"]`,
    );

    failedScript?.dispatchEvent(new Event('error'));
    await expect(first).resolves.toBe(false);
    expect(failedScript?.isConnected).toBe(false);

    const second = ensureMiniProgramJssdk();
    const retryScript = document.querySelector<HTMLScriptElement>(
      `script[src="${JSSDK_URL}"]`,
    );

    expect(retryScript).not.toBe(failedScript);
    Object.defineProperty(window, 'wx', {
      configurable: true,
      value: { miniProgram: {} },
    });
    retryScript?.dispatchEvent(new Event('load'));
    await expect(second).resolves.toBe(true);
  });

  it('retries when the script loads before wx.miniProgram is ready', async () => {
    const { ensureMiniProgramJssdk } = await loadModule();
    const first = ensureMiniProgramJssdk();
    const incompleteScript = document.querySelector<HTMLScriptElement>(
      `script[src="${JSSDK_URL}"]`,
    );

    Object.defineProperty(window, 'wx', { configurable: true, value: {} });
    incompleteScript?.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(false);
    expect(incompleteScript?.isConnected).toBe(false);

    const second = ensureMiniProgramJssdk();
    const retryScript = document.querySelector<HTMLScriptElement>(
      `script[src="${JSSDK_URL}"]`,
    );

    expect(retryScript).not.toBe(incompleteScript);
    Object.defineProperty(window, 'wx', {
      configurable: true,
      value: { miniProgram: {} },
    });
    retryScript?.dispatchEvent(new Event('load'));
    await expect(second).resolves.toBe(true);
  });

  it('times out conservatively when the official SDK never settles', async () => {
    vi.useFakeTimers();
    const { ensureMiniProgramJssdk } = await loadModule();
    const ready = ensureMiniProgramJssdk();

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(ready).resolves.toBe(false);
  });

  it('shares one in-flight load across concurrent callers', async () => {
    const { ensureMiniProgramJssdk } = await loadModule();
    const first = ensureMiniProgramJssdk();
    const second = ensureMiniProgramJssdk();
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      `script[src="${JSSDK_URL}"]`,
    );

    expect(scripts).toHaveLength(1);
    Object.defineProperty(window, 'wx', {
      configurable: true,
      value: { miniProgram: {} },
    });
    scripts[0]?.dispatchEvent(new Event('load'));
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });
});
