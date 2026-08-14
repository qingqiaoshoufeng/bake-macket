const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type RandomUuidFactory = () => string | Promise<string>;

export function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

export function uuidV4FromBytes(source: ArrayBuffer): string {
  const bytes = new Uint8Array(source);
  if (bytes.length !== 16) {
    throw new Error('安全随机源必须返回 16 字节');
  }
  const uuidBytes = Uint8Array.from(bytes);
  uuidBytes[6] = (uuidBytes[6]! & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8]! & 0x3f) | 0x80;
  const hexadecimal = Array.from(uuidBytes)
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

export async function createSecureUuidV4(): Promise<string> {
  if (typeof wx.getRandomValues !== 'function') {
    throw new Error('当前微信运行时不支持安全随机数');
  }
  const { randomValues } = await wx.getRandomValues({ length: 16 });
  return uuidV4FromBytes(randomValues);
}

export async function requireUuidV4(
  factory: RandomUuidFactory,
): Promise<string> {
  const value = await factory();
  if (!isUuidV4(value)) {
    throw new Error('无法生成安全的操作标识，请重试');
  }
  return value;
}
