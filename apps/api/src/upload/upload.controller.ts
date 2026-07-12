import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import { PresignUploadDto } from './dto.js';
import { UploadService } from './upload.service.js';

@Controller('upload')
@UseGuards(JwtAdminGuard)
export class UploadController {
  constructor(private readonly uploads: UploadService) {}

  @Post('presign') presign(@Body() dto: PresignUploadDto) {
    return this.uploads.presign(dto);
  }
}
