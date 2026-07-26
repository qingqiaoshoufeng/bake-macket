import { describe, expect, it, vi } from 'vitest';

const vantStyleImport = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({
  mount: vi.fn(),
  use: vi.fn(),
}));

vi.mock('vue', () => ({
  createApp: vi.fn(() => app),
}));
vi.mock('./App.vue', () => ({ default: {} }));
vi.mock('./router/index.js', () => ({ router: {} }));
vi.mock('pinia', () => ({ createPinia: vi.fn(() => ({})) }));
vi.mock('vant/lib/index.css', () => {
  vantStyleImport();
  return {};
});

describe('H5 application bootstrap', () => {
  it('loads Vant global component styles for interactive primitives', async () => {
    await import('./main.js');

    expect(vantStyleImport).toHaveBeenCalledOnce();
  });
});
