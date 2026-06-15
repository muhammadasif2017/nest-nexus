import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('storage.bucket')!;
    this.endpoint = config.get<string | undefined>('storage.endpoint');

    this.client = new S3Client({
      region: config.get<string>('storage.region'),
      credentials: {
        accessKeyId: config.get<string>('storage.accessKeyId')!,
        secretAccessKey: config.get<string>('storage.secretAccessKey')!,
      },
      ...(this.endpoint && {
        endpoint: this.endpoint,
        forcePathStyle: config.get<boolean>('storage.forcePathStyle'),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      // Bucket doesn't exist — create it (MinIO auto-creates on first use but S3 requires explicit create)
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket: ${this.bucket}`);
      } catch (createErr) {
        this.logger.warn(`Could not create bucket "${this.bucket}": ${(createErr as Error).message}`);
      }
    }
  }

  async upload(
    key: string,
    buffer: Buffer,
    mimeType: string,
    options?: { cacheControl?: string; metadata?: Record<string, string> },
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: options?.cacheControl ?? 'public, max-age=31536000, immutable',
        Metadata: options?.metadata,
      }),
    );
    return this.getPublicUrl(key);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  getPublicUrl(key: string): string {
    if (this.endpoint) {
      // MinIO path-style: http://localhost:9000/bucket/key
      return `${this.endpoint}/${this.bucket}/${key}`;
    }
    // AWS virtual-hosted style: https://bucket.s3.region.amazonaws.com/key
    const region = this.config.get<string>('storage.region');
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }
}
