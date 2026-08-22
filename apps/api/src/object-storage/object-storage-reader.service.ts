import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/env.schema.js';
import { createObjectStorageClient } from './object-storage-client.js';

export type ObjectMetadata = Readonly<{
  contentType?: string;
  contentLength?: number;
}>;

@Injectable()
export class ObjectStorageReaderService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const env = config.get('appEnv', { infer: true });
    this.client = createObjectStorageClient(env);
    this.bucket = env.OBJECT_STORAGE_BUCKET;
  }

  async copy(
    sourceKey: string,
    destinationKey: string,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${encodeURIComponent(sourceKey).replace(/%2F/gu, '/')}`,
        Key: destinationKey,
        ContentType: contentType,
        MetadataDirective: 'REPLACE',
      }),
    );
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }

  async head(objectKey: string): Promise<ObjectMetadata> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    return {
      contentType: result.ContentType,
      contentLength: result.ContentLength,
    };
  }

  async readPrefix(objectKey: string, length: number): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Range: `bytes=0-${length - 1}`,
      }),
    );
    if (!result.Body) return new Uint8Array();
    const bytes = await result.Body.transformToByteArray();
    return bytes.slice(0, length);
  }
}
