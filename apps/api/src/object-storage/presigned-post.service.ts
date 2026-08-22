import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

import type { PresignUploadContentType } from '@bake-mall/contracts';

import type { AppConfig } from '../config/env.schema.js';
import { createObjectStorageClient } from './object-storage-client.js';

export type CreatePresignedPostInput = Readonly<{
  objectKey: string;
  contentType: PresignUploadContentType;
  maxSizeBytes: number;
}>;

export type CreatedPresignedPost = Readonly<{
  uploadUrl: string;
  fields: Record<string, string>;
  expiresAt: string;
}>;

const EXPIRES_SECONDS = 300;

@Injectable()
export class PresignedPostService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async create(input: CreatePresignedPostInput): Promise<CreatedPresignedPost> {
    const env = this.config.get('appEnv', { infer: true });
    const signed = await createPresignedPost(
      createObjectStorageClient(
        env,
        env.OBJECT_STORAGE_CLIENT_ENDPOINT ?? env.OBJECT_STORAGE_ENDPOINT,
      ),
      {
        Bucket: env.OBJECT_STORAGE_BUCKET,
        Key: input.objectKey,
        Fields: { 'Content-Type': input.contentType },
        Conditions: [
          ['content-length-range', 1, input.maxSizeBytes],
          { 'Content-Type': input.contentType },
          { key: input.objectKey },
        ],
        Expires: EXPIRES_SECONDS,
      },
    );
    return {
      uploadUrl: signed.url,
      fields: signed.fields,
      expiresAt: new Date(Date.now() + EXPIRES_SECONDS * 1000).toISOString(),
    };
  }
}
