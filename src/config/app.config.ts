import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN,
  alertsWebhookUrl: process.env.ALERTS_WEBHOOK_URL,
  totpEncryptionKey: process.env.TOTP_ENCRYPTION_KEY!,
  emailWorkerConcurrency: parseInt(process.env.QUEUE_EMAIL_CONCURRENCY || '5', 10),
  webauthnRpId: process.env.WEBAUTHN_RP_ID || 'localhost',
  webauthnRpName: process.env.WEBAUTHN_RP_NAME || 'nest-nexus',
}));
