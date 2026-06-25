import { z } from 'zod';
export const configValidationSchema = (config: Record<string, unknown>) => {
  const schema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    CLIENT_ORIGIN: z.string().url(),

    DATABASE_URL: z.string().startsWith('postgresql'),
    DATABASE_POOL_MAX: z.coerce.number().min(1).max(200).default(10),

    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD: z.string().optional(),

    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    TOTP_ENCRYPTION_KEY: z
      .string()
      .regex(
        /^[0-9a-fA-F]{64}$/,
        'TOTP_ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes for AES-256)',
      ),

    QUEUE_EMAIL_CONCURRENCY: z.coerce.number().min(1).max(50).default(5),

    // SMTP is optional — when SMTP_HOST is unset, EmailProcessor falls back to
    // logging the email intent instead of sending (matches pre-Phase-5 behavior).
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(587),
    // z.coerce.boolean() does Boolean(str), and Boolean("false") is true (any
    // non-empty string is truthy) — that mutates process.env.SMTP_SECURE to "true"
    // after validate() runs, breaking the STARTTLS negotiation on port 587.
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default('Nexus <no-reply@example.com>'),
  });

  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    // Format Zod errors into a readable startup crash message
    const issues = parsed.error.issues
      .map((i) => `  [${i.path.join('.')}]: ${i.message}`)
      .join('\n');
    throw new Error(`\n❌ Invalid environment variables:\n${issues}`);
  }

  return parsed.data;
};
