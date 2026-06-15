import { configValidationSchema } from './config.validation';

const validConfig = {
  NODE_ENV: 'test',
  PORT: '3000',
  CLIENT_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'a'.repeat(32),
  MONGODB_URI: 'mongodb://localhost:27017/test',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  JWT_SECRET: 'b'.repeat(32),
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'c'.repeat(32),
  JWT_REFRESH_EXPIRES_IN: '7d',
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
      const result = configValidationSchema({ ...validConfig, NODE_ENV: 'production' });
      expect(result.NODE_ENV).toBe('production');
    });

    it('accepts test', () => {
      const result = configValidationSchema({ ...validConfig, NODE_ENV: 'test' });
      expect(result.NODE_ENV).toBe('test');
    });

    it('throws for invalid NODE_ENV value', () => {
      expect(() =>
        configValidationSchema({ ...validConfig, NODE_ENV: 'staging' }),
      ).toThrow();
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

  describe('SESSION_SECRET validation', () => {
    it('throws when SESSION_SECRET is shorter than 32 chars', () => {
      expect(() =>
        configValidationSchema({ ...validConfig, SESSION_SECRET: 'short' }),
      ).toThrow();
    });

    it('throws when SESSION_SECRET is missing', () => {
      const { SESSION_SECRET: _, ...rest } = validConfig;
      expect(() => configValidationSchema(rest)).toThrow();
    });

    it('accepts SESSION_SECRET of exactly 32 chars', () => {
      const result = configValidationSchema({ ...validConfig, SESSION_SECRET: 'x'.repeat(32) });
      expect(result.SESSION_SECRET).toHaveLength(32);
    });
  });

  describe('MONGODB_URI validation', () => {
    it('throws when MONGODB_URI does not start with mongodb', () => {
      expect(() =>
        configValidationSchema({ ...validConfig, MONGODB_URI: 'postgres://localhost/db' }),
      ).toThrow();
    });

    it('throws when MONGODB_URI is missing', () => {
      const { MONGODB_URI: _, ...rest } = validConfig;
      expect(() => configValidationSchema(rest)).toThrow();
    });

    it('accepts mongodb+srv URI', () => {
      const result = configValidationSchema({
        ...validConfig,
        MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/db',
      });
      expect(result.MONGODB_URI).toMatch(/^mongodb/);
    });
  });

  describe('JWT secrets validation', () => {
    it('throws when JWT_SECRET is shorter than 32 chars', () => {
      expect(() =>
        configValidationSchema({ ...validConfig, JWT_SECRET: 'tooshort' }),
      ).toThrow();
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
        expect(message).toContain('SESSION_SECRET');
      }
    });
  });
});
