const ASCII_CHARACTER = /^[ -~]$/u;
const PRESERVED_WHITESPACE = new Set([9, 10, 13]);

const isPrintableCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0) ?? 0;

  return (
    PRESERVED_WHITESPACE.has(codePoint) ||
    (codePoint >= 32 &&
      codePoint !== 127 &&
      (codePoint < 128 || codePoint > 159))
  );
};

export const sanitizePrintableText = (text: string): string =>
  [...text.normalize('NFC')].filter(isPrintableCharacter).join('');

export const displayWidth = (text: string): number =>
  [...sanitizePrintableText(text)].reduce(
    (width, character) =>
      width +
      (character === '\n' || character === '\r'
        ? 0
        : ASCII_CHARACTER.test(character)
          ? 1
          : 2),
    0,
  );
