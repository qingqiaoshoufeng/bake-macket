import { alignColumns, wrapByDisplayWidth } from './text-layout.js';

export type ReceiptLayoutCapability = Readonly<{
  charactersPerLine: number;
  feedLines: number;
  supportsCut: boolean;
  cutCommandHex: string | null;
}>;

export type PocReceipt = Readonly<{
  lines: readonly string[];
  feedLines: number;
  cutCommandHex: string | null;
}>;

const TEST_SECTIONS = [
  'ASCII TEST: BAKE MALL 123',
  '中文测试：草莓奶油蛋糕',
  '长商品名测试：草莓海盐奶盖生日蛋糕六寸少糖版本',
  '备注测试：蛋糕写“生日快乐”，请提前十分钟联系',
  '配送地址测试：幸福路一百二十三号烘焙商城测试门店',
] as const;

export const buildPocReceipt = (
  capability: ReceiptLayoutCapability,
): PocReceipt => {
  const wrappedSections = TEST_SECTIONS.flatMap((section) =>
    wrapByDisplayWidth(section, capability.charactersPerLine),
  );
  const separator = '-'.repeat(capability.charactersPerLine);
  const lines = Object.freeze([
    ...wrappedSections,
    separator,
    alignColumns('商品合计', '118.00', capability.charactersPerLine),
    alignColumns('会员优惠', '-8.80', capability.charactersPerLine),
    alignColumns('应付金额', '89.20', capability.charactersPerLine),
  ]);

  return Object.freeze({
    lines,
    feedLines: capability.feedLines,
    cutCommandHex: capability.supportsCut ? capability.cutCommandHex : null,
  });
};
