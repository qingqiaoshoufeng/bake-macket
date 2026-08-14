import { createHash } from 'node:crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

const canonicalJson = (
  value: unknown,
  path = '<root>',
  seen = new Set<object>(),
): JsonValue => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `canonical JSON contains non-finite number at ${path}`,
      );
    }
    return value;
  }
  if (typeof value !== 'object' || value instanceof Date) {
    throw new TypeError(`canonical JSON contains unsupported value at ${path}`);
  }
  if (seen.has(value))
    throw new TypeError(`canonical JSON contains cycle at ${path}`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).length !== value.length + 1) {
        throw new TypeError(`canonical JSON contains sparse array at ${path}`);
      }
      return value.map((child, index) =>
        canonicalJson(child, `${path}.${index}`, seen),
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `canonical JSON contains unsupported object at ${path}`,
      );
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      throw new TypeError(
        `canonical JSON contains unsupported symbol at ${path}`,
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Object.fromEntries(
      (ownKeys as string[]).sort().map((key) => {
        const descriptor = descriptors[key];
        if (
          !descriptor?.enumerable ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined
        ) {
          throw new TypeError(
            `canonical JSON contains unsupported property at ${path}.${key}`,
          );
        }
        return [
          key,
          canonicalJson(
            (value as Record<string, unknown>)[key],
            `${path}.${key}`,
            seen,
          ),
        ];
      }),
    );
  } finally {
    seen.delete(value);
  }
};

export const hashPrintPayload = (payload: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalJson(payload)), 'utf8')
    .digest('hex');
