import { BadRequestException } from '@nestjs/common';
import { ImageService } from './image.service';

// Minimal valid 1×1 PNG (67 bytes)
const VALID_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e00000000c49444154789c6260000000020001e221bc330000000049454e44ae426082',
  'hex',
);

// Minimal valid JPEG header
const VALID_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(60).fill(0)]);

// Buffer that passes magic-byte check but will fail Sharp processing
const CORRUPT_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 0xff), // invalid PNG body
]);

// Plain text — no valid image magic bytes
const NOT_AN_IMAGE = Buffer.from('hello world');

describe('ImageService', () => {
  let service: ImageService;

  beforeEach(() => {
    service = new ImageService();
  });

  describe('validateImageType', () => {
    it('accepts PNG by magic bytes', () => {
      expect(() => service.validateImageType(VALID_PNG)).not.toThrow();
    });

    it('accepts JPEG by magic bytes', () => {
      expect(() => service.validateImageType(VALID_JPEG)).not.toThrow();
    });

    it('throws BadRequestException for non-image buffer', () => {
      expect(() => service.validateImageType(NOT_AN_IMAGE)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for buffer shorter than 12 bytes', () => {
      expect(() => service.validateImageType(Buffer.alloc(4))).toThrow(BadRequestException);
    });
  });

  describe('processAvatar', () => {
    it('throws BadRequestException for non-image buffer', async () => {
      await expect(service.processAvatar(NOT_AN_IMAGE)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for corrupt PNG body', async () => {
      await expect(service.processAvatar(CORRUPT_PNG)).rejects.toThrow(BadRequestException);
    });
  });

  describe('resize', () => {
    it('throws BadRequestException for non-image buffer', async () => {
      await expect(service.resize(NOT_AN_IMAGE, 100)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for corrupt PNG body', async () => {
      await expect(service.resize(CORRUPT_PNG, 100)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMetadata', () => {
    it('throws BadRequestException for corrupt buffer', async () => {
      await expect(service.getMetadata(Buffer.from('not-an-image'))).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
