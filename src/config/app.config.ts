import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET,
  clientOrigin: process.env.CLIENT_ORIGIN,
  alertsWebhookUrl: process.env.ALERTS_WEBHOOK_URL,
  totpEncryptionKey: process.env.TOTP_ENCRYPTION_KEY!,
  emailWorkerConcurrency: parseInt(process.env.QUEUE_EMAIL_CONCURRENCY || '5', 10),
}));
