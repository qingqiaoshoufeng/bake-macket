import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import type { PresignUploadResponse } from '@bake-mall/contracts';

import { type AppConfig } from '../config/env.schema.js';
import { joinMediaUrl } from '../media-url.js';
import { PresignedPostService } from '../object-storage/presigned-post.service.js';
import { PresignUploadDto } from './dto.js';

@Injectable()
export class UploadService {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    @Optional() private readonly presignedPosts?: PresignedPostService,
  ) {}

  async presign(
    dto: PresignUploadDto,
  ): Promise<PresignUploadResponse & { url: string }> {
    const env = this.config.get('appEnv', { infer: true });
    const extension = extensionFor(dto.fileName, dto.contentType);
    const objectKey = `${dto.scope}/${randomUUID()}${extension}`;
    const presignedPosts =
      this.presignedPosts ?? new PresignedPostService(this.config);
    const signed = await presignedPosts.create({
      objectKey,
      contentType: dto.contentType,
      maxSizeBytes: 5 * 1024 * 1024,
    });
    return {
      objectKey,
      publicUrl: joinMediaUrl(env.OBJECT_STORAGE_PUBLIC_BASE_URL, objectKey),
      uploadUrl: signed.uploadUrl,
      fields: signed.fields,
      expiresAt: signed.expiresAt,
      // Deprecated compatibility alias. New clients must use uploadUrl.
      url: signed.uploadUrl,
    };
  }
}

function extensionFor(
  fileName: string,
  contentType: PresignUploadDto['contentType'],
): string {
  const extension = extname(fileName).toLowerCase();
  const accepted = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp'],
  } as const;
  if (accepted[contentType].includes(extension as never)) return extension;
  if (!fileName.trim()) throw new BadRequestException('File name is required');
  return { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[
    contentType
  ];
}
