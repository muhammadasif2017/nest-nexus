import { z } from 'zod';
export const configValidationSchema = (config: Record<string, unknown>) => {
  const schema = z
    .object({
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

      // WebAuthn — RP ID must not be 'localhost' in production (passkeys are bound
      // to the RP ID; wrong value means enrolled credentials can never authenticate).
      WEBAUTHN_RP_ID: z.string().default('localhost'),
      WEBAUTHN_RP_NAME: z.string().default('nest-nexus'),

      // OAuth — all optional (providers are opt-in). Listed here so a typo in an
      // env var name is caught at startup rather than silently using 'NOT_CONFIGURED'.
      GOOGLE_CLIENT_ID: z.string().optional(),
      GOOGLE_CLIENT_SECRET: z.string().optional(),
      GITHUB_CLIENT_ID: z.string().optional(),
      GITHUB_CLIENT_SECRET: z.string().optional(),
      MICROSOFT_CLIENT_ID: z.string().optional(),
      MICROSOFT_CLIENT_SECRET: z.string().optional(),

      ALERTS_WEBHOOK_URL: z.string().url().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.NODE_ENV === 'production' && data.WEBAUTHN_RP_ID === 'localhost') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WEBAUTHN_RP_ID'],
          message: 'WEBAUTHN_RP_ID must not be "localhost" in production',
        });
      }
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
