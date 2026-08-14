import { readonly, ref, type Ref } from 'vue';

import { PRINTABLE_DIAGNOSTIC_STEPS } from '../config/diagnostic-steps.js';
import type {
  DiagnosticStep,
  DiagnosticStepResult,
  PrintableDiagnosticStep,
  PrinterDiagnosticInput,
} from '../type/index.js';

export type PrinterDiagnosticAdapter = Readonly<{
  connect: () => Promise<void>;
  printProbe: (step: PrintableDiagnosticStep) => Promise<void>;
  performCut: () => Promise<void>;
  confirmPaperOutput: (step: DiagnosticStep) => Promise<boolean>;
}>;

const errorDetail = (error: unknown): string =>
  error instanceof Error ? error.message : '未知诊断错误';

const runStep = async (
  step: PrintableDiagnosticStep,
  adapter: PrinterDiagnosticAdapter,
): Promise<DiagnosticStepResult> => {
  try {
    await adapter.printProbe(step);
    const paperConfirmed = await adapter.confirmPaperOutput(step);

    return paperConfirmed
      ? { step, outcome: 'PASSED', detail: '人工确认完整出纸' }
      : { step, outcome: 'FAILED', detail: '未确认完整出纸' };
  } catch (error) {
    return { step, outcome: 'FAILED', detail: errorDetail(error) };
  }
};

const runPrintableSteps = async (
  adapter: PrinterDiagnosticAdapter,
): Promise<readonly DiagnosticStepResult[]> =>
  PRINTABLE_DIAGNOSTIC_STEPS.reduce<Promise<readonly DiagnosticStepResult[]>>(
    async (pendingResults, step) => {
      const results = await pendingResults;
      if (results.some(({ outcome }) => outcome === 'FAILED')) return results;

      return [...results, await runStep(step, adapter)];
    },
    Promise.resolve([]),
  );

const cutResult = async (
  input: PrinterDiagnosticInput,
  adapter: PrinterDiagnosticAdapter,
): Promise<DiagnosticStepResult> => {
  if (!input.testCut || !input.capability.supportsCut) {
    return { step: 'CUT', outcome: 'SKIPPED', detail: '切刀未启用或未验证' };
  }

  try {
    await adapter.performCut();
    const confirmed = await adapter.confirmPaperOutput('CUT');
    return confirmed
      ? { step: 'CUT', outcome: 'PASSED', detail: '人工确认切刀动作' }
      : { step: 'CUT', outcome: 'FAILED', detail: '未确认切刀动作' };
  } catch (error) {
    return { step: 'CUT', outcome: 'FAILED', detail: errorDetail(error) };
  }
};

export const runPrinterDiagnostics = async (
  input: PrinterDiagnosticInput,
  adapter: PrinterDiagnosticAdapter,
): Promise<readonly DiagnosticStepResult[]> => {
  try {
    await adapter.connect();
  } catch (error) {
    return [
      { step: 'TCP_CONNECT', outcome: 'FAILED', detail: errorDetail(error) },
    ];
  }

  const connectionResult: DiagnosticStepResult = {
    step: 'TCP_CONNECT',
    outcome: 'PASSED',
    detail: 'TCP 连接成功',
  };
  const printableResults = await runPrintableSteps(adapter);
  if (printableResults.some(({ outcome }) => outcome === 'FAILED')) {
    return [connectionResult, ...printableResults];
  }

  return [
    connectionResult,
    ...printableResults,
    await cutResult(input, adapter),
  ];
};

export type PrinterDiagnosticState = Readonly<{
  running: Readonly<Ref<boolean>>;
  results: Readonly<Ref<readonly DiagnosticStepResult[]>>;
  run: () => Promise<void>;
}>;

export const usePrinterDiagnostic = (
  getInput: () => PrinterDiagnosticInput,
  createAdapter: (input: PrinterDiagnosticInput) => PrinterDiagnosticAdapter,
): PrinterDiagnosticState => {
  const running = ref(false);
  const results = ref<readonly DiagnosticStepResult[]>([]);

  const run = async (): Promise<void> => {
    running.value = true;
    results.value = [];

    try {
      const input = getInput();
      results.value = await runPrinterDiagnostics(input, createAdapter(input));
    } finally {
      running.value = false;
    }
  };

  return Object.freeze({
    running: readonly(running),
    results: readonly(results),
    run,
  });
};
