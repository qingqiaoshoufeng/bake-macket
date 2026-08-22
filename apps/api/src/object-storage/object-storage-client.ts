import { S3Client } from '@aws-sdk/client-s3';

import type { AppEnv } from '../config/env.schema.js';

export type ObjectStorageEnv = Pick<
  AppEnv,
  | 'OBJECT_STORAGE_REGION'
  | 'OBJECT_STORAGE_ENDPOINT'
  | 'OBJECT_STORAGE_FORCE_PATH_STYLE'
  | 'OBJECT_STORAGE_ACCESS_KEY'
  | 'OBJECT_STORAGE_SECRET_KEY'
>;

export const createObjectStorageClient = (
  env: ObjectStorageEnv,
  endpoint = env.OBJECT_STORAGE_ENDPOINT,
): S3Client =>
  new S3Client({
    region: env.OBJECT_STORAGE_REGION,
    endpoint,
    forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY,
    },
  });
