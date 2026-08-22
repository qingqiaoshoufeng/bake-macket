import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { ObjectStorageModule } from '../object-storage/object-storage.module.js';
import { UploadController } from './upload.controller.js';
import { UploadService } from './upload.service.js';

@Module({
  imports: [AuthModule, ObjectStorageModule],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule {}
