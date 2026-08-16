const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function uuidV4FromBytes(source: Uint8Array): string {
  const bytes = Uint8Array.from(source);
  if (bytes.length !== 16) throw new Error('安全随机源必须返回 16 字节');
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hexadecimal = Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20),
  ].join('-');
}

export function createSecureUuidV4(): string {
  const runtimeCrypto = globalThis.crypto;
  if (!runtimeCrypto) {
    throw new Error('当前浏览器不支持安全随机数，请升级后重试');
  }
  const randomUUID = (runtimeCrypto as Crypto & { randomUUID?: () => string })
    .randomUUID;
  const value =
    typeof randomUUID === 'function'
      ? randomUUID.call(runtimeCrypto)
      : typeof runtimeCrypto.getRandomValues === 'function'
        ? uuidV4FromBytes(runtimeCrypto.getRandomValues(new Uint8Array(16)))
        : null;
  if (!value || !UUID_V4_PATTERN.test(value)) {
    throw new Error('无法生成安全的操作标识，请升级浏览器后重试');
  }
  return value;
}
