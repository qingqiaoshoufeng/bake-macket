import { FAKE_PRINTER_CAPABILITY } from '../../capabilities/fake-capability.fixture.js';
import type { PrinterDiagnosticInput } from '../type/index.js';

export const FAKE_DIAGNOSTIC_INPUT: PrinterDiagnosticInput = Object.freeze({
  host: '127.0.0.1',
  capability: FAKE_PRINTER_CAPABILITY,
  testCut: false,
});
