function randomByte(): number {
  return Math.floor(Math.random() * 256);
}

function createUuidBytes(webCrypto?: Crypto): Uint8Array {
  const bytes = webCrypto?.getRandomValues
    ? webCrypto.getRandomValues(new Uint8Array(16))
    : Uint8Array.from({ length: 16 }, randomByte);
  return Uint8Array.from(bytes, (byte, index) =>
    index === 6
      ? (byte & 0x0f) | 0x40
      : index === 8
        ? (byte & 0x3f) | 0x80
        : byte,
  );
}

export function generateIdempotencyKey(): string {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof webCrypto?.randomUUID === 'function')
    return webCrypto.randomUUID();
  const hex = Array.from(createUuidBytes(webCrypto), (byte) =>
    byte.toString(16).padStart(2, '0'),
  );
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
