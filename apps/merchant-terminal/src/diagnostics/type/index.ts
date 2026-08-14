export type DiagnosticStep =
  | 'TCP_CONNECT'
  | 'ASCII'
  | 'CHINESE'
  | 'ALIGNMENT'
  | 'LONG_TEXT'
  | 'FEED'
  | 'CUT';

export type PrintableDiagnosticStep = Exclude<
  DiagnosticStep,
  'TCP_CONNECT' | 'CUT'
>;

export type DiagnosticStepResult = Readonly<{
  step: DiagnosticStep;
  outcome: 'PASSED' | 'FAILED' | 'SKIPPED';
  detail: string;
}>;

export type PrinterDiagnosticCapability = Readonly<{
  tcpPort: number;
  encoding: 'GB18030' | 'GBK';
  charactersPerLine: number;
  connectionTimeoutMs: number;
  writeTimeoutMs: number;
  feedLines: number;
  supportsCut: boolean;
  cutCommandHex: string | null;
}>;

export type PrinterDiagnosticInput = Readonly<{
  host: string;
  capability: PrinterDiagnosticCapability;
  testCut: boolean;
}>;
