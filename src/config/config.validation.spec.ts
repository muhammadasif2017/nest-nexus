import { configValidationSchema } from './config.validation';

const validConfig = {
  NODE_ENV: 'test',
  PORT: '3000',
  CLIENT_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nest_nexus',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  JWT_SECRET: 'b'.repeat(32),
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'c'.repeat(32),
  JWT_REFRESH_EXPIRES_IN: '7d',
  TOTP_ENCRYPTION_KEY: 'a'.repeat(64), // 64 hex chars = 32 bytes for AES-256
};

describe('configValidationSchema', () => {
  describe('valid config', () => {
    it('returns parsed data for a complete valid config', () => {
      const result = configValidationSchema(validConfig);
      expect(result).toBeDefined();
    });

    it('coerces PORT from string to number', () => {
      const result = configValidationSchema({ ...validConfig, PORT: '8080' });
      expect(result.PORT).toBe(8080);
      expect(typeof result.PORT).toBe('number');
    });

    it('coerces REDIS_PORT from string to number', () => {
      const result = configValidationSchema({ ...validConfig, REDIS_PORT: '6380' });
      expect(result.REDIS_PORT).toBe(6380);
    });

    it('defaults NODE_ENV to development when omitted', () => {
      const { NODE_ENV: _, ...rest } = validConfig;
      const result = configValidationSchema(rest);
      expect(result.NODE_ENV).toBe('development');
    });

    it('defaults PORT to 3000 when omitted', () => {
      const { PORT: _, ...rest } = validConfig;
      const result = configValidationSchema(rest);
      expect(result.PORT).toBe(3000);
    });

    it('defaults JWT_EXPIRES_IN to 15m when omitted', () => {
      const { JWT_EXPIRES_IN: _, ...rest } = validConfig;
      const result = configValidationSchema(rest);
      expect(result.JWT_EXPIRES_IN).toBe('15m');
    });

    it('defaults JWT_REFRESH_EXPIRES_IN to 7d when omitted', () => {
      const { JWT_REFRESH_EXPIRES_IN: _, ...rest } = validConfig;
      const result = configValidationSchema(rest);
      expect(result.JWT_REFRESH_EXPIRES_IN).toBe('7d');
    });

    it('allows REDIS_PASSWORD to be omitted', () => {
      const result = configValidationSchema(validConfig);
      expect(result.REDIS_PASSWORD).toBeUndefined();
    });

    it('accepts REDIS_PASSWORD when provided', () => {
      const result = configValidationSchema({ ...validConfig, REDIS_PASSWORD: 'secret' });
      expect(result.REDIS_PASSWORD).toBe('secret');
    });
  });

  describe('NODE_ENV validation', () => {
    it('accepts development', () => {
      const result = configValidationSchema({ ...validConfig, NODE_ENV: 'development' });
      expect(result.NODE_ENV).toBe('development');
    });

    it('accepts production', () => {
      const result = configValidationSchema({
        ...validConfig,
        NODE_ENV: 'production',
        WEBAUTHN_RP_ID: 'example.com',
      });
      expect(result.NODE_ENV).toBe('production');
    });

    it('accepts test', () => {
      const result = configValidationSchema({ ...validConfig, NODE_ENV: 'test' });
      expect(result.NODE_ENV).toBe('test');
    });

    it('throws for invalid NODE_ENV value', () => {
      expect(() => configValidationSchema({ ...validConfig, NODE_ENV: 'staging' })).toThrow();
    });
  });

  describe('CLIENT_ORIGIN validation', () => {
    it('throws when CLIENT_ORIGIN is not a valid URL', () => {
      expect(() =>
        configValidationSchema({ ...validConfig, CLIENT_ORIGIN: 'not-a-url' }),
      ).toThrow();
    });

    it('throws when CLIENT_ORIGIN is missing', () => {
      const { CLIENT_ORIGIN: _, ...rest } = validConfig;
      expect(() => configValidationSchema(rest)).toThrow();
    });
  });

  describe('DATABASE_URL validation', () => {
    it('throws when DATABASE_URL does not start with postgresql', () => {
      expect(() =>
        configValidationSchema({ ...validConfig, DATABASE_URL: 'mongodb://localhost/db' }),
      ).toThrow();
    });

    it('throws when DATABASE_URL is missing', () => {
      const { DATABASE_URL: _, ...rest } = validConfig;
      expect(() => configValidationSchema(rest)).toThrow();
    });

    it('accepts a full postgresql connection string', () => {
      const result = configValidationSchema({
        ...validConfig,
        DATABASE_URL: 'postgresql://user:pass@host:5432/mydb',
      });
      expect(result.DATABASE_URL).toMatch(/^postgresql/);
    });
  });

  describe('JWT secrets validation', () => {
    it('throws when JWT_SECRET is shorter than 32 chars', () => {
      expect(() => configValidationSchema({ ...validConfig, JWT_SECRET: 'tooshort' })).toThrow();
    });

    it('throws when JWT_REFRESH_SECRET is shorter than 32 chars', () => {
      expect(() =>
        configValidationSchema({ ...validConfig, JWT_REFRESH_SECRET: 'tooshort' }),
      ).toThrow();
    });

    it('throws when JWT_SECRET is missing', () => {
      const { JWT_SECRET: _, ...rest } = validConfig;
      expect(() => configValidationSchema(rest)).toThrow();
    });

    it('throws when JWT_REFRESH_SECRET is missing', () => {
      const { JWT_REFRESH_SECRET: _, ...rest } = validConfig;
      expect(() => configValidationSchema(rest)).toThrow();
    });
  });

  describe('TOTP_ENCRYPTION_KEY validation', () => {
    it('accepts a valid 64-char hex key', () => {
      const result = configValidationSchema({
        ...validConfig,
        TOTP_ENCRYPTION_KEY: 'f'.repeat(64),
      });
      expect(result.TOTP_ENCRYPTION_KEY).toHaveLength(64);
    });

    it('throws when TOTP_ENCRYPTION_KEY is missing', () => {
      const { TOTP_ENCRYPTION_KEY: _, ...rest } = validConfig;
      expect(() => configValidationSchema(rest)).toThrow();
    });

    it('throws when TOTP_ENCRYPTION_KEY is shorter than 64 chars', () => {
      expect(() =>
        configValidationSchema({ ...validConfig, TOTP_ENCRYPTION_KEY: 'a'.repeat(63) }),
      ).toThrow();
    });

    it('throws when TOTP_ENCRYPTION_KEY contains non-hex characters', () => {
      expect(() =>
        configValidationSchema({ ...validConfig, TOTP_ENCRYPTION_KEY: 'g'.repeat(64) }),
      ).toThrow();
    });
  });

  describe('WEBAUTHN_RP_ID validation', () => {
    it('defaults to localhost in non-production', () => {
      const result = configValidationSchema({ ...validConfig, NODE_ENV: 'development' });
      expect(result.WEBAUTHN_RP_ID).toBe('localhost');
    });

    it('throws when WEBAUTHN_RP_ID is localhost in production', () => {
      expect(() =>
        configValidationSchema({
          ...validConfig,
          NODE_ENV: 'production',
          WEBAUTHN_RP_ID: 'localhost',
        }),
      ).toThrow(/WEBAUTHN_RP_ID/);
    });

    it('throws when WEBAUTHN_RP_ID is omitted in production (defaults to localhost)', () => {
      expect(() => configValidationSchema({ ...validConfig, NODE_ENV: 'production' })).toThrow(
        /WEBAUTHN_RP_ID/,
      );
    });

    it('accepts a real domain in production', () => {
      const result = configValidationSchema({
        ...validConfig,
        NODE_ENV: 'production',
        WEBAUTHN_RP_ID: 'api.example.com',
      });
      expect(result.WEBAUTHN_RP_ID).toBe('api.example.com');
    });
  });

  describe('OAuth vars validation', () => {
    it('allows all OAuth vars to be omitted', () => {
      const result = configValidationSchema(validConfig);
      expect(result.GOOGLE_CLIENT_ID).toBeUndefined();
      expect(result.GITHUB_CLIENT_ID).toBeUndefined();
      expect(result.MICROSOFT_CLIENT_ID).toBeUndefined();
    });

    it('accepts GOOGLE_CLIENT_ID when provided', () => {
      const result = configValidationSchema({ ...validConfig, GOOGLE_CLIENT_ID: 'gid-123' });
      expect(result.GOOGLE_CLIENT_ID).toBe('gid-123');
    });
  });

  describe('error message format', () => {
    it('includes field path in error message', () => {
      const { CLIENT_ORIGIN: _, ...rest } = validConfig;
      expect(() => configValidationSchema(rest)).toThrow(/CLIENT_ORIGIN/);
    });

    it('includes multiple field errors in one message', () => {
      try {
        configValidationSchema({ NODE_ENV: 'test' });
        fail('Expected error to be thrown');
      } catch (e: unknown) {
        const message = (e as Error).message;
        expect(message).toContain('CLIENT_ORIGIN');
        expect(message).toContain('DATABASE_URL');
      }
    });
  });
});
