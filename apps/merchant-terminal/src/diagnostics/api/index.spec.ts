import { describe, expect, it, vi } from 'vitest';

import { FAKE_DIAGNOSTIC_INPUT } from '../mock/diagnostic.mock.js';
import {
  buildDiagnosticProbe,
  createNativePrinterDiagnosticAdapter,
} from './index.js';

const printerMocks = vi.hoisted(() => ({
  connectPrinter: vi.fn(),
  encodeCutCommand: vi.fn(),
  encodePrinterText: vi.fn(),
}));

vi.mock('@/uni_modules/bake-escpos-printer', () => printerMocks);

describe('createNativePrinterDiagnosticAdapter', () => {
  it('builds a distinct payload for every printable diagnostic step', () => {
    const probes = ['ASCII', 'CHINESE', 'ALIGNMENT', 'LONG_TEXT', 'FEED'].map(
      (step) => buildDiagnosticProbe(step as never, FAKE_DIAGNOSTIC_INPUT),
    );

    expect(new Set(probes).size).toBe(5);
    expect(probes[0]).toMatch(/ASCII TEST/u);
    expect(probes[1]).toMatch(/中文测试/u);
    expect(probes[2]).toMatch(/应付金额/u);
    expect(probes[3].replaceAll('\n', '')).toContain(
      '长商品名测试：草莓海盐奶盖生日蛋糕六寸少糖版本',
    );
    expect(probes[3].replaceAll('\n', '')).toContain(
      '备注测试：蛋糕写“生日快乐”，请提前十分钟联系',
    );
    expect(probes[3].replaceAll('\n', '')).toContain(
      '配送地址测试：幸福路一百二十三号烘焙商城测试门店',
    );
    expect(probes[4]).toBe(
      '\n'.repeat(FAKE_DIAGNOSTIC_INPUT.capability.feedLines),
    );
  });

  it('encodes the verified cut command inside the native plugin', async () => {
    const write = vi.fn().mockResolvedValue(3);
    const close = vi.fn().mockResolvedValue(undefined);
    printerMocks.connectPrinter.mockResolvedValue({ write, close });
    printerMocks.encodeCutCommand.mockReturnValue(new Uint8Array([29, 86, 0]));
    const input = {
      ...FAKE_DIAGNOSTIC_INPUT,
      capability: {
        ...FAKE_DIAGNOSTIC_INPUT.capability,
        supportsCut: true,
        cutCommandHex: '1d5600',
      },
    } as const;
    const adapter = createNativePrinterDiagnosticAdapter(input, {
      confirmPaperOutput: vi.fn(),
    });

    await adapter.performCut();

    expect(printerMocks.encodeCutCommand).toHaveBeenCalledWith('1d5600');
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports smoke success and failure without exposing printer details', async () => {
    const write = vi.fn().mockResolvedValue(34);
    const close = vi.fn().mockResolvedValue(undefined);
    printerMocks.connectPrinter.mockResolvedValue({ write, close });
    printerMocks.encodePrinterText.mockReturnValue(new Uint8Array(34));
    const log = vi.fn();
    const { runDiagnosticSmoke } = await import('./smoke.js');

    await expect(
      runDiagnosticSmoke(FAKE_DIAGNOSTIC_INPUT, { log }),
    ).resolves.toBe('SUCCESS');
    expect(log).toHaveBeenCalledWith('BAKE_TERMINAL_SMOKE_RESULT:SUCCESS');

    write.mockRejectedValueOnce(new Error('socket reset at 4 bytes'));
    await expect(
      runDiagnosticSmoke(FAKE_DIAGNOSTIC_INPUT, { log }),
    ).resolves.toBe('FAILED');
    expect(log).toHaveBeenCalledWith('BAKE_TERMINAL_SMOKE_RESULT:FAILED');
    expect(JSON.stringify(log.mock.calls)).not.toContain('socket reset');
  });

  it('delegates paper output confirmation instead of assuming success', async () => {
    const confirmPaperOutput = vi.fn().mockResolvedValue(false);
    const adapter = createNativePrinterDiagnosticAdapter(
      FAKE_DIAGNOSTIC_INPUT,
      { confirmPaperOutput },
    );

    await expect(adapter.confirmPaperOutput('CHINESE')).resolves.toBe(false);
    expect(confirmPaperOutput).toHaveBeenCalledWith('CHINESE');
  });
});
