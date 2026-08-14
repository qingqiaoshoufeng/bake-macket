import {
  connectPrinter,
  encodeCutCommand,
  encodePrinterText,
} from '@/uni_modules/bake-escpos-printer';

import { buildPocReceipt } from '../../receipt/poc-receipt.js';
import { wrapByDisplayWidth } from '../../receipt/text-layout.js';
import type { PrinterDiagnosticAdapter } from '../hooks/usePrinterDiagnostic.js';
import type {
  PrintableDiagnosticStep,
  PrinterDiagnosticInput,
} from '../type/index.js';

const LONG_TEXT_PROBES = [
  '长商品名测试：草莓海盐奶盖生日蛋糕六寸少糖版本',
  '备注测试：蛋糕写“生日快乐”，请提前十分钟联系',
  '配送地址测试：幸福路一百二十三号烘焙商城测试门店',
] as const;

const probeLines = (
  step: Exclude<PrintableDiagnosticStep, 'FEED'>,
  input: PrinterDiagnosticInput,
): readonly string[] => {
  if (step === 'LONG_TEXT') {
    return LONG_TEXT_PROBES.flatMap((probe) =>
      wrapByDisplayWidth(probe, input.capability.charactersPerLine),
    );
  }

  const receipt = buildPocReceipt(input.capability);
  const selectors = {
    ASCII: (line: string) => line.startsWith('ASCII TEST:'),
    CHINESE: (line: string) => line.startsWith('中文测试：'),
    ALIGNMENT: (line: string) =>
      ['商品合计', '会员优惠', '应付金额'].some((label) =>
        line.startsWith(label),
      ),
  } as const;

  return receipt.lines.filter(selectors[step]);
};

export const buildDiagnosticProbe = (
  step: PrintableDiagnosticStep,
  input: PrinterDiagnosticInput,
): string =>
  step === 'FEED'
    ? '\n'.repeat(input.capability.feedLines)
    : `[${step}]\n${probeLines(step, input).join('\n')}\n`;

const withPrinterConnection = async (
  input: PrinterDiagnosticInput,
  action: (
    connection: Awaited<ReturnType<typeof connectPrinter>>,
  ) => Promise<void>,
): Promise<void> => {
  const connection = await connectPrinter(
    input.host,
    input.capability.tcpPort,
    input.capability.connectionTimeoutMs,
    input.capability.writeTimeoutMs,
  );

  try {
    await action(connection);
  } finally {
    await connection.close();
  }
};

export type PrinterDiagnosticPrompts = Readonly<{
  confirmPaperOutput: (
    step: Parameters<PrinterDiagnosticAdapter['confirmPaperOutput']>[0],
  ) => Promise<boolean>;
}>;

export const createNativePrinterDiagnosticAdapter = (
  input: PrinterDiagnosticInput,
  prompts: PrinterDiagnosticPrompts,
): PrinterDiagnosticAdapter => ({
  async connect() {
    await withPrinterConnection(input, async () => undefined);
  },
  async printProbe(step) {
    await withPrinterConnection(input, async (connection) => {
      const bytes = encodePrinterText(
        buildDiagnosticProbe(step, input),
        input.capability.encoding,
      );
      await connection.write(bytes);
    });
  },
  async performCut() {
    const cutCommandHex = input.capability.cutCommandHex;
    if (!input.capability.supportsCut || cutCommandHex === null) {
      throw new Error('Cut capability is not verified');
    }

    await withPrinterConnection(input, async (connection) => {
      await connection.write(encodeCutCommand(cutCommandHex));
    });
  },
  confirmPaperOutput: prompts.confirmPaperOutput,
});
