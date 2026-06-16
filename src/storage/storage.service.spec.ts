import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

// Mock the entire AWS SDK — no real S3 calls in unit tests
jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn();
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockSend,
      destroy: jest.fn(),
    })),
    PutObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    HeadBucketCommand: jest.fn(),
    CreateBucketCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://presigned-url.example.com/key'),
}));

const mockConfig = () => ({
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
      'storage.bucket': 'test-bucket',
      'storage.region': 'us-east-1',
      'storage.accessKeyId': 'test-key',
      'storage.secretAccessKey': 'test-secret',
      'storage.endpoint': undefined,
      'storage.forcePathStyle': false,
    };
    return map[key];
  }),
});

describe('StorageService', () => {
  let service: StorageService;
  let mockSend: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    const { __mockSend } = require('@aws-sdk/client-s3');
    mockSend = __mockSend;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: mockConfig() },
      ],
    }).compile();
    service = module.get(StorageService);
  });

  describe('onModuleInit', () => {
    it('logs when bucket already exists (HeadBucket succeeds)', async () => {
      mockSend.mockResolvedValueOnce({}); // HeadBucket success
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('creates bucket when HeadBucket fails', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('NoSuchBucket'))
        .mockResolvedValueOnce({}); // CreateBucket success
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('logs warning when bucket creation also fails', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('NoSuchBucket'))
        .mockRejectedValueOnce(new Error('AccessDenied'));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('destroys the S3 client', () => {
      service.onModuleDestroy();
      const { S3Client } = require('@aws-sdk/client-s3');
      const instance = S3Client.mock.results[0].value;
      expect(instance.destroy).toHaveBeenCalled();
    });
  });

  describe('upload', () => {
    const key = 'avatars/user-1/photo.webp';
    const buffer = Buffer.from('fake-image');
    const mimeType = 'image/webp';

    it('returns public URL on success', async () => {
      mockSend.mockResolvedValueOnce({});
      const url = await service.upload(key, buffer, mimeType);
      expect(url).toContain(key);
    });

    it('throws InternalServerErrorException when S3 rejects', async () => {
      mockSend.mockRejectedValueOnce(new Error('S3 network error'));
      await expect(service.upload(key, buffer, mimeType)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('delete', () => {
    const key = 'uploads/user-1/file.pdf';

    it('resolves on success', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(service.delete(key)).resolves.toBeUndefined();
    });

    it('throws InternalServerErrorException when S3 rejects', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
      await expect(service.delete(key)).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getPublicUrl', () => {
    it('returns AWS virtual-hosted URL when no endpoint configured', () => {
      const url = service.getPublicUrl('my/key.webp');
      expect(url).toBe('https://test-bucket.s3.us-east-1.amazonaws.com/my/key.webp');
    });
  });

  describe('getPresignedUrl', () => {
    it('returns a presigned URL', async () => {
      const url = await service.getPresignedUrl('private/doc.pdf');
      expect(url).toBe('https://presigned-url.example.com/key');
    });
  });
});
