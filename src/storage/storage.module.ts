import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ImageService } from './image.service';
import { ClamAvService } from './clamav.service';
import { UploadController } from './upload.controller';

@Module({
  providers: [StorageService, ImageService, ClamAvService],
  controllers: [UploadController],
  exports: [StorageService, ImageService, ClamAvService],
})
export class StorageModule {}
