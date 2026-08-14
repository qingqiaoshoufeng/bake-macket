import type { DiagnosticStep, PrintableDiagnosticStep } from '../type/index.js';

export const DIAGNOSTIC_STEPS: readonly DiagnosticStep[] = Object.freeze([
  'TCP_CONNECT',
  'ASCII',
  'CHINESE',
  'ALIGNMENT',
  'LONG_TEXT',
  'FEED',
  'CUT',
]);

export const PRINTABLE_DIAGNOSTIC_STEPS: readonly PrintableDiagnosticStep[] =
  Object.freeze(['ASCII', 'CHINESE', 'ALIGNMENT', 'LONG_TEXT', 'FEED']);

export const DIAGNOSTIC_STEP_LABELS: Readonly<Record<DiagnosticStep, string>> =
  Object.freeze({
    TCP_CONNECT: 'TCP 连接',
    ASCII: '英文测试',
    CHINESE: '中文测试',
    ALIGNMENT: '中英文与金额对齐',
    LONG_TEXT: '长文本换行',
    FEED: '走纸',
    CUT: '切刀',
  });
