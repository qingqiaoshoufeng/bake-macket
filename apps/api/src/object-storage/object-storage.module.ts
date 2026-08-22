import { Module } from '@nestjs/common';

import { ObjectStorageReaderService } from './object-storage-reader.service.js';
import { PresignedPostService } from './presigned-post.service.js';

@Module({
  providers: [ObjectStorageReaderService, PresignedPostService],
  exports: [ObjectStorageReaderService, PresignedPostService],
})
export class ObjectStorageModule {}
