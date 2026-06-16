// src/config/config.validation.ts
import { z } from 'zod';

// This schema is the single source of truth for ALL required environment variables.
// Zod will coerce types (e.g., string "3000" → number 3000) and throw a
// ZodError with a human-readable message if anything is missing or wrong.
export const configValidationSchema = (config: Record<string, unknown>) => {
  const schema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    CLIENT_ORIGIN: z.string().url(),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),

    DATABASE_URL: z.string().startsWith('postgresql'),
    DATABASE_POOL_MAX: z.coerce.number().min(1).max(200).default(10),
    DATABASE_SESSION_POOL_MAX: z.coerce.number().min(1).max(20).default(5),

    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD: z.string().optional(),

    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    TOTP_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'TOTP_ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes for AES-256)'),
  });

  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    // Format Zod errors into a readable startup crash message
    const issues = parsed.error.issues
      .map((i) => `  [${i.path.join('.')}]: ${i.message}`)
      .join('\n');
    throw new Error(`\n❌ Invalid environment variables:\n${issues}`);
  }

  return parsed.data; // Returns the validated, typed config object
};