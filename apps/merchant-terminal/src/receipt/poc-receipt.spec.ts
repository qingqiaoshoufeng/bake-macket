import { describe, expect, it } from 'vitest';

import { FAKE_PRINTER_CAPABILITY } from '../capabilities/fake-capability.fixture.js';
import { displayWidth, sanitizePrintableText } from './display-width.js';
import { buildPocReceipt } from './poc-receipt.js';
import { alignColumns, wrapByDisplayWidth } from './text-layout.js';

describe('58mm text layout', () => {
  it('uses display cells instead of string length', () => {
    expect(displayWidth('AB草莓')).toBe(6);
    expect(wrapByDisplayWidth('草莓奶油蛋糕ABC', 8)).toEqual([
      '草莓奶油',
      '蛋糕ABC',
    ]);
  });

  it('removes ESC/POS controls without removing printable line breaks', () => {
    expect(
      sanitizePrintableText(
        `备注${String.fromCharCode(27)}@${String.fromCharCode(0x85)}安全\n下一行`,
      ),
    ).toBe('备注@安全\n下一行');
  });

  it('right aligns amounts within the verified display width', () => {
    const line = alignColumns(
      '应付金额',
      '89.20',
      FAKE_PRINTER_CAPABILITY.charactersPerLine,
    );

    expect(displayWidth(line)).toBe(FAKE_PRINTER_CAPABILITY.charactersPerLine);
    expect(line.endsWith('89.20')).toBe(true);
  });

  it('builds immutable receipt probes and skips an unverified cutter', () => {
    const receipt = buildPocReceipt(FAKE_PRINTER_CAPABILITY);

    expect(receipt.lines).toContain('中文测试：草莓奶油蛋糕');
    expect(receipt.lines.some((line) => line.includes('89.20'))).toBe(true);
    expect(receipt.feedLines).toBe(FAKE_PRINTER_CAPABILITY.feedLines);
    expect(receipt.cutCommandHex).toBeNull();
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.lines)).toBe(true);
  });
});
