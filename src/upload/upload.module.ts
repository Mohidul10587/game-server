import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MulterModule } from '@nestjs/platform-express';
import { UploadService } from './upload.service.js';
import { UploadController } from './upload.controller.js';

@Module({
  imports: [AuthModule, MulterModule.register({})],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule {}
