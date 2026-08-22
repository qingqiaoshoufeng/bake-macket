import type { PresignUploadContentType } from '@bake-mall/contracts';

export const MAX_CUSTOMER_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_CUSTOMER_NICKNAME_LENGTH = 64;

export const CUSTOMER_AVATAR_CONTENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
] as const satisfies readonly PresignUploadContentType[]);

export const CUSTOMER_AVATAR_EXTENSIONS = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const satisfies Readonly<Record<string, PresignUploadContentType>>);
