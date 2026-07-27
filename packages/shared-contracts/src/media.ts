export type MediaAsset = {
  objectKey: string;
  publicUrl: string;
};

export type PresignUploadScope = 'products' | 'banners';
export type PresignUploadContentType =
  'image/jpeg' | 'image/png' | 'image/webp';

export type PresignUploadRequest = {
  scope: PresignUploadScope;
  fileName: string;
  contentType: PresignUploadContentType;
  sizeBytes: number;
};

export type PresignUploadResponse = MediaAsset & {
  uploadUrl: string;
  fields: Record<string, string>;
  expiresAt: string;
};
