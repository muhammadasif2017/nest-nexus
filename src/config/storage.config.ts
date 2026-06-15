import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'minio',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'minio123',
  region: process.env.AWS_REGION ?? 'us-east-1',
  bucket: process.env.AWS_BUCKET_NAME ?? 'nexus-uploads',
  // Set for MinIO or any S3-compatible store. Leave unset for real AWS S3.
  endpoint: process.env.AWS_ENDPOINT,
  // forcePathStyle must be true for MinIO (it doesn't support virtual-hosted buckets)
  forcePathStyle: !!process.env.AWS_ENDPOINT,
  clamavHost: process.env.CLAMAV_HOST ?? 'localhost',
  clamavPort: parseInt(process.env.CLAMAV_PORT ?? '3310', 10),
  // Set CLAMAV_ENABLED=false to skip virus scanning in local dev (no Docker)
  clamavEnabled: process.env.CLAMAV_ENABLED !== 'false',
}));
