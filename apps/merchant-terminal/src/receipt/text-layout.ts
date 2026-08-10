import { displayWidth, sanitizePrintableText } from './display-width.js';

const appendCharacter = (
  lines: readonly string[],
  character: string,
  maximumWidth: number,
): readonly string[] => {
  const currentLine = lines.at(-1) ?? '';
  const nextLine = `${currentLine}${character}`;

  if (character === '\n') return [...lines, ''];
  if (displayWidth(nextLine) <= maximumWidth) {
    return [...lines.slice(0, -1), nextLine];
  }

  return [...lines, character];
};

export const wrapByDisplayWidth = (
  text: string,
  maximumWidth: number,
): readonly string[] => {
  if (!Number.isInteger(maximumWidth) || maximumWidth < 1) {
    throw new Error('maximumWidth must be a positive integer');
  }

  return [...sanitizePrintableText(text)].reduce<readonly string[]>(
    (lines, character) => appendCharacter(lines, character, maximumWidth),
    [''],
  );
};

export const alignColumns = (
  left: string,
  right: string,
  maximumWidth: number,
): string => {
  const safeLeft = sanitizePrintableText(left).replaceAll('\n', ' ');
  const safeRight = sanitizePrintableText(right).replaceAll('\n', ' ');
  const spacing =
    maximumWidth - displayWidth(safeLeft) - displayWidth(safeRight);

  if (spacing < 1) {
    throw new Error('Columns exceed the available display width');
  }

  return `${safeLeft}${' '.repeat(spacing)}${safeRight}`;
};
