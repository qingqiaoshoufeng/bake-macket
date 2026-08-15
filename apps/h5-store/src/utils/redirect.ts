function containsControlOrSpace(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 32 || codePoint === 127;
  });
}

export function resolveSafeInternalRedirect(
  value: unknown,
  fallback = '/',
): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    containsControlOrSpace(value)
  ) {
    return fallback;
  }
  return value;
}
