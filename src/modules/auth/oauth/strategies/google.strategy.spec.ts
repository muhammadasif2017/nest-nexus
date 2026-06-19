import { ConfigService } from '@nestjs/config';
import { VerifyCallback } from 'passport-google-oauth20';
import { GoogleStrategy } from './google.strategy';

const makeConfigMock = () => ({
  get: jest.fn().mockReturnValue('config-value'),
});

const makeStrategy = () => new GoogleStrategy(makeConfigMock() as unknown as ConfigService);

const makeProfile = (overrides: Record<string, unknown> = {}) => ({
  id: 'google-id-1',
  displayName: 'Jane Doe',
  emails: [{ value: 'jane@example.com' }],
  photos: [{ value: 'https://example.com/avatar.png' }],
  ...overrides,
});

describe('GoogleStrategy', () => {
  describe('validate()', () => {
    it('maps profile to OAuthProfile shape with provider "google"', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('access', 'refresh', makeProfile(), done as VerifyCallback);
      expect(done).toHaveBeenCalledWith(null, {
        provider: 'google',
        providerId: 'google-id-1',
        email: 'jane@example.com',
        displayName: 'Jane Doe',
        avatar: 'https://example.com/avatar.png',
      });
    });

    it('uses profile.id as providerId', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile({ id: 'distinct-id' }), done as VerifyCallback);
      const [, user] = done.mock.calls[0];
      expect(user.providerId).toBe('distinct-id');
    });

    it('sets email to undefined when emails array is missing', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile({ emails: undefined }), done as VerifyCallback);
      const [, user] = done.mock.calls[0];
      expect(user.email).toBeUndefined();
    });

    it('sets avatar to undefined when photos array is missing', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile({ photos: undefined }), done as VerifyCallback);
      const [, user] = done.mock.calls[0];
      expect(user.avatar).toBeUndefined();
    });

    it('calls done with null error on success', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile(), done as VerifyCallback);
      expect(done.mock.calls[0][0]).toBeNull();
    });
  });
});
