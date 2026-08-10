import {
  connectPrinter,
  encodePrinterText,
} from '@/uni_modules/bake-escpos-printer';

import type { PrinterDiagnosticInput } from '../type/index.js';
import { buildDiagnosticProbe } from './index.js';

export type DiagnosticSmokeResult = 'SUCCESS' | 'FAILED';

export const runDiagnosticSmoke = async (
  input: PrinterDiagnosticInput,
  output: Readonly<{ log: (message: string) => void }>,
): Promise<DiagnosticSmokeResult> => {
  let connection: Awaited<ReturnType<typeof connectPrinter>> | null = null;
  try {
    connection = await connectPrinter(
      input.host,
      input.capability.tcpPort,
      input.capability.connectionTimeoutMs,
      input.capability.writeTimeoutMs,
    );
    const bytes = encodePrinterText(
      buildDiagnosticProbe('ASCII', input),
      input.capability.encoding,
    );
    await connection.write(bytes);
    output.log('BAKE_TERMINAL_SMOKE_RESULT:SUCCESS');
    return 'SUCCESS';
  } catch {
    output.log('BAKE_TERMINAL_SMOKE_RESULT:FAILED');
    return 'FAILED';
  } finally {
    await connection?.close().catch(() => undefined);
  }
};
