import {
  Controller, Post, Delete, Param, UploadedFile,
  UseInterceptors, UseGuards, ParseFilePipe,
  MaxFileSizeValidator, HttpCode, HttpStatus, ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
  ApiConsumes, ApiBody,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import crypto from 'crypto';
import { StorageService } from './storage.service';
import { ImageService } from './image.service';
import { ClamAvService } from './clamav.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../modules/auth/strategies/jwt.strategy';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;  // 5 MB
const MAX_FILE_SIZE = 20 * 1024 * 1024;  // 20 MB

@ApiTags('upload')
@Controller('upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class UploadController {
  constructor(
    private readonly storage: StorageService,
    private readonly image: ImageService,
    private readonly clamav: ClamAvService,
  ) {}

  @Post('avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload profile avatar', description: 'Scans for viruses, resizes to 256×256 WebP, uploads to S3.' })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 200, description: 'Upload successful.', schema: { properties: { url: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Virus detected or unsupported file type.' })
  async uploadAvatar(
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE })] }))
    file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ url: string }> {
    await this.clamav.scanOrThrow(file.buffer);
    const { buffer, mimeType } = await this.image.processAvatar(file.buffer);
    const key = `avatars/${user.sub}/${crypto.randomUUID()}.webp`;
    const url = await this.storage.upload(key, buffer, mimeType);
    return { url };
  }

  @Post('file')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a generic file', description: 'Virus-scanned. Stored as-is (no image processing). Max 20 MB.' })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 200, description: 'Upload successful.', schema: { properties: { url: { type: 'string' }, key: { type: 'string' } } } })
  async uploadFile(
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })] }))
    file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ url: string; key: string }> {
    await this.clamav.scanOrThrow(file.buffer);

    const ext = file.originalname.split('.').pop() ?? 'bin';
    const key = `uploads/${user.sub}/${crypto.randomUUID()}.${ext}`;
    const url = await this.storage.upload(key, file.buffer, file.mimetype, {
      metadata: { originalName: file.originalname, uploadedBy: user.sub },
    });
    return { url, key };
  }

  @Delete(':key(*)')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an uploaded file', description: 'Key must be owned by the authenticated user (prefixed with avatars/{userId}/ or uploads/{userId}/).' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiResponse({ status: 403, description: 'Key does not belong to the authenticated user.' })
  async deleteFile(
    @Param('key') key: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    const owned =
      key.startsWith(`avatars/${user.sub}/`) ||
      key.startsWith(`uploads/${user.sub}/`);
    if (!owned) {
      throw new ForbiddenException('You do not have permission to delete this file.');
    }
    await this.storage.delete(key);
  }
}
