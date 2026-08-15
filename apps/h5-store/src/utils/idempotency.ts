function createUuidBytes(webCrypto: Crypto): Uint8Array {
  if (typeof webCrypto.getRandomValues !== 'function') {
    throw new Error('当前环境缺少安全随机源，无法提交请求');
  }
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  return Uint8Array.from(bytes, (byte, index) =>
    index === 6
      ? (byte & 0x0f) | 0x40
      : index === 8
        ? (byte & 0x3f) | 0x80
        : byte,
  );
}

export function generateSecureUuidV4(): string {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (!webCrypto) {
    throw new Error('当前环境缺少安全随机源，无法提交请求');
  }
  if (typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  const hex = Array.from(createUuidBytes(webCrypto), (byte) =>
    byte.toString(16).padStart(2, '0'),
  );
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export const generateIdempotencyKey = generateSecureUuidV4;
