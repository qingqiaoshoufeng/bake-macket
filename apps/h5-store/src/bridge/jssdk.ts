export const MINI_PROGRAM_JSSDK_URL =
  'https://res.wx.qq.com/open/js/jweixin-1.3.2.js';
export const MINI_PROGRAM_JSSDK_TIMEOUT_MS = 5_000;

let pendingLoad: Promise<boolean> | null = null;
let resolvedLoad: Promise<boolean> | null = null;

function hasWechatJssdk(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.wx?.miniProgram === 'object'
  );
}

function loadWechatJssdk(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    const script = document.createElement('script');
    let timeoutId: number | null = null;
    const settle = (loaded: boolean): void => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      script.onload = null;
      script.onerror = null;

      const ready = loaded && hasWechatJssdk();
      if (!ready) script.remove();
      pendingLoad = null;
      resolve(ready);
    };

    timeoutId = window.setTimeout(
      () => settle(false),
      MINI_PROGRAM_JSSDK_TIMEOUT_MS,
    );
    script.async = true;
    script.src = MINI_PROGRAM_JSSDK_URL;
    script.onload = () => settle(true);
    script.onerror = () => settle(false);
    document.head.append(script);
  });
}

export function ensureMiniProgramJssdk(): Promise<boolean> {
  if (hasWechatJssdk()) {
    resolvedLoad ??= Promise.resolve(true);
    return resolvedLoad;
  }
  if (!pendingLoad) pendingLoad = loadWechatJssdk();
  return pendingLoad;
}
