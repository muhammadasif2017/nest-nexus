import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';
import { RefreshTokenPayload } from '../token.service';

const makeConfigMock = () => ({
  get: jest.fn().mockReturnValue('test-refresh-secret'),
});

const makeStrategy = () => new JwtRefreshStrategy(makeConfigMock() as unknown as ConfigService);

const makeRequest = (rawToken?: string): Request =>
  ({ cookies: rawToken !== undefined ? { refresh_token: rawToken } : {} }) as unknown as Request;

const makePayload = (overrides: Partial<RefreshTokenPayload> = {}): RefreshTokenPayload => ({
  sub: 'user-id-1',
  jti: 'jti-1',
  family: 'family-1',
  ...overrides,
});

describe('JwtRefreshStrategy', () => {
  describe('validate()', () => {
    it('throws UnauthorizedException when refresh_token cookie is missing', async () => {
      const strategy = makeStrategy();
      await expect(strategy.validate(makeRequest(), makePayload())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns payload merged with rawToken read from the cookie', async () => {
      const strategy = makeStrategy();
      const payload = makePayload();
      const result = await strategy.validate(makeRequest('raw-cookie-value'), payload);
      expect(result).toEqual({ ...payload, rawToken: 'raw-cookie-value' });
    });

    it('reads the raw token from cookies, not from the verified payload', async () => {
      const strategy = makeStrategy();
      const result = await strategy.validate(
        makeRequest('cookie-token'),
        makePayload({ sub: 'distinct-user' }),
      );
      expect(result.rawToken).toBe('cookie-token');
      expect(result.sub).toBe('distinct-user');
    });
  });
});
