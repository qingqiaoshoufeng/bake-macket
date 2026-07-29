const hasUnsafeFilenameCharacter = (filename: string): boolean =>
  Array.from(filename).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      character === '/' ||
      character === '\\' ||
      codePoint < 32 ||
      codePoint === 127
    );
  });

export function safeDownloadFilename(
  filename: string | null | undefined,
): string | undefined {
  const normalized = filename?.trim();
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    hasUnsafeFilenameCharacter(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

export function saveBlob(blob: Blob, filename: string): void {
  const safeFilename = safeDownloadFilename(filename);
  if (!safeFilename) throw new Error('下载文件名不安全');
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function'
  ) {
    throw new Error('当前环境不支持浏览器文件下载');
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = safeFilename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
