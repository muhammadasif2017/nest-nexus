import { Injectable, BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const AVATAR_SIZE = 256;
const THUMBNAIL_QUALITY = 80;

// Magic-byte detection — more reliable than browser-supplied Content-Type
function detectMimeType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  // WebP: RIFF????WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}

@Injectable()
export class ImageService {
  validateImageType(buffer: Buffer): string {
    const mime = detectMimeType(buffer);
    if (!mime || !ALLOWED_IMAGE_TYPES.has(mime)) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: ${[...ALLOWED_IMAGE_TYPES].join(', ')}`,
      );
    }
    return mime;
  }

  // Resize to square avatar, convert to WebP for smaller payloads
  async processAvatar(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
    return this.processWithSharp(buffer, (image) =>
      image
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
        .webp({ quality: THUMBNAIL_QUALITY }),
    );
  }

  // Generic resize — preserves aspect ratio, outputs WebP
  async resize(
    buffer: Buffer,
    width: number,
    height?: number,
    quality = THUMBNAIL_QUALITY,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    return this.processWithSharp(buffer, (image) =>
      image.resize(width, height, { fit: 'inside', withoutEnlargement: true }).webp({ quality }),
    );
  }

  private async processWithSharp(
    buffer: Buffer,
    transform: (image: sharp.Sharp) => sharp.Sharp,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    this.validateImageType(buffer);
    try {
      const processed = await transform(sharp(buffer)).toBuffer();
      return { buffer: processed, mimeType: 'image/webp' };
    } catch {
      throw new BadRequestException('Invalid or corrupted image file.');
    }
  }

  async getMetadata(buffer: Buffer): Promise<sharp.Metadata> {
    try {
      return await sharp(buffer).metadata();
    } catch {
      throw new BadRequestException('Invalid or corrupted image file.');
    }
  }
}
