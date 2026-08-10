export type PrinterEncoding = 'GB18030' | 'GBK';

export type PrinterBytes = Uint8Array;

export type PrinterConnection = Readonly<{
  write: (bytes: PrinterBytes) => Promise<number>;
  close: () => Promise<void>;
}>;

export function connectPrinter(
  host: string,
  port: number,
  connectTimeoutMs: number,
  writeTimeoutMs: number,
): Promise<PrinterConnection>;

export function encodePrinterText(
  text: string,
  encoding: PrinterEncoding,
): PrinterBytes;

export function encodeCutCommand(hex: string): PrinterBytes;
