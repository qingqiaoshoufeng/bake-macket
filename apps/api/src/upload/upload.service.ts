import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import type { PresignUploadResponse } from '@bake-mall/contracts';

import { type AppConfig } from '../config/env.schema.js';
import { joinMediaUrl } from '../media-url.js';
import { PresignUploadDto } from './dto.js';

@Injectable()
export class UploadService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async presign(
    dto: PresignUploadDto,
  ): Promise<PresignUploadResponse & { url: string }> {
    const env = this.config.get('appEnv', { infer: true });
    const extension = extensionFor(dto.fileName, dto.contentType);
    const objectKey = `${dto.scope}/${randomUUID()}${extension}`;
    const client = new S3Client({
      region: env.OBJECT_STORAGE_REGION,
      endpoint: env.OBJECT_STORAGE_ENDPOINT,
      forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY,
        secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY,
      },
    });
    const signed = await createPresignedPost(client, {
      Bucket: env.OBJECT_STORAGE_BUCKET,
      Key: objectKey,
      Fields: { 'Content-Type': dto.contentType },
      Conditions: [
        ['content-length-range', 1, 5 * 1024 * 1024],
        { 'Content-Type': dto.contentType },
        ['starts-with', '$key', `${dto.scope}/`],
      ],
      Expires: 300,
    });
    const expiresAt = new Date(Date.now() + 300 * 1000).toISOString();
    return {
      objectKey,
      publicUrl: joinMediaUrl(env.OBJECT_STORAGE_PUBLIC_BASE_URL, objectKey),
      uploadUrl: signed.url,
      fields: signed.fields,
      expiresAt,
      // Deprecated compatibility alias. New clients must use uploadUrl.
      url: signed.url,
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
