import { describe, expect, it, vi } from 'vitest';

import { FAKE_PRINTER_CAPABILITY } from '../../capabilities/fake-capability.fixture.js';
import {
  runPrinterDiagnostics,
  type PrinterDiagnosticAdapter,
} from './usePrinterDiagnostic.js';

const createAdapter = (): PrinterDiagnosticAdapter => ({
  connect: vi.fn().mockResolvedValue(undefined),
  printProbe: vi.fn().mockResolvedValue(undefined),
  performCut: vi.fn().mockResolvedValue(undefined),
  confirmPaperOutput: vi.fn().mockResolvedValue(true),
});

describe('runPrinterDiagnostics', () => {
  it('requires all receipt checks before optional cut testing', async () => {
    const result = await runPrinterDiagnostics(
      {
        host: '127.0.0.1',
        capability: FAKE_PRINTER_CAPABILITY,
        testCut: false,
      },
      createAdapter(),
    );

    expect(result.map(({ step }) => step)).toEqual([
      'TCP_CONNECT',
      'ASCII',
      'CHINESE',
      'ALIGNMENT',
      'LONG_TEXT',
      'FEED',
      'CUT',
    ]);
    expect(result.at(-1)).toMatchObject({
      step: 'CUT',
      outcome: 'SKIPPED',
    });
  });

  it('sends the verified cut command before asking for confirmation', async () => {
    const adapter = createAdapter();
    const cutCapability = {
      ...FAKE_PRINTER_CAPABILITY,
      supportsCut: true,
      cutCommandHex: '1d5600',
    } as const;

    const result = await runPrinterDiagnostics(
      {
        host: '127.0.0.1',
        capability: cutCapability,
        testCut: true,
      },
      adapter,
    );

    expect(adapter.performCut).toHaveBeenCalledOnce();
    expect(result.at(-1)).toEqual({
      step: 'CUT',
      outcome: 'PASSED',
      detail: '人工确认切刀动作',
    });
  });

  it('does not run later probes after a failed step', async () => {
    const adapter = createAdapter();
    vi.mocked(adapter.printProbe).mockRejectedValueOnce(
      new Error('printer disconnected'),
    );

    const result = await runPrinterDiagnostics(
      {
        host: '127.0.0.1',
        capability: FAKE_PRINTER_CAPABILITY,
        testCut: false,
      },
      adapter,
    );

    expect(result).toEqual([
      { step: 'TCP_CONNECT', outcome: 'PASSED', detail: 'TCP 连接成功' },
      {
        step: 'ASCII',
        outcome: 'FAILED',
        detail: 'printer disconnected',
      },
    ]);
    expect(adapter.printProbe).toHaveBeenCalledTimes(1);
  });
});
