import type { PresignUploadContentType } from '@bake-mall/contracts';

import { CUSTOMER_AVATAR_EXTENSIONS } from '../config/avatar.js';
import type { InspectedAvatarFile } from '../type/index.js';

function fileNameFromPath(filePath: string): string {
  const cleanPath = filePath.split('?')[0] ?? filePath;
  const segments = cleanPath.split('/');
  return segments[segments.length - 1] || 'avatar';
}

function contentTypeFromFileName(
  fileName: string,
): PresignUploadContentType | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return (
    CUSTOMER_AVATAR_EXTENSIONS[
      extension as keyof typeof CUSTOMER_AVATAR_EXTENSIONS
    ] ?? null
  );
}

function inspectImageFormat(
  filePath: string,
): Promise<PresignUploadContentType | null> {
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: filePath,
      success(result) {
        const contentType =
          result.type === 'jpeg'
            ? 'image/jpeg'
            : result.type === 'png'
              ? 'image/png'
              : null;
        resolve(contentType);
      },
      fail() {
        resolve(null);
      },
    });
  });
}

export async function inspectAvatarFile(
  filePath: string,
): Promise<InspectedAvatarFile> {
  const imageContentType = await inspectImageFormat(filePath);
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().stat({
      path: filePath,
      recursive: false,
      success(result) {
        const stats = Array.isArray(result.stats) ? null : result.stats;
        const fileName = fileNameFromPath(filePath);
        const extensionContentType = contentTypeFromFileName(fileName);
        const contentType = imageContentType ?? extensionContentType;
        if (!contentType) {
          reject(new Error('仅支持 JPEG、PNG 或 WebP 头像'));
          return;
        }
        if (!stats) {
          reject(new Error('无法读取头像文件'));
          return;
        }
        resolve({ contentType, fileName, filePath, sizeBytes: stats.size });
      },
      fail() {
        reject(new Error('无法读取头像文件'));
      },
    });
  });
}
