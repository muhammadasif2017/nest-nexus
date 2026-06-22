import { ConfigService } from '@nestjs/config';
import { MicrosoftStrategy } from './microsoft.strategy';

const makeConfigMock = () => ({
  get: jest.fn().mockReturnValue('config-value'),
});

const makeStrategy = () => new MicrosoftStrategy(makeConfigMock() as unknown as ConfigService);

const makeProfile = (overrides: Record<string, unknown> = {}) => ({
  id: 'microsoft-id-1',
  displayName: 'Jane Doe',
  emails: [{ value: 'jane@example.com' }],
  ...overrides,
});

describe('MicrosoftStrategy', () => {
  describe('validate()', () => {
    it('maps profile to OAuthProfile shape with provider "microsoft"', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('access', 'refresh', makeProfile(), done);
      expect(done).toHaveBeenCalledWith(null, {
        provider: 'microsoft',
        providerId: 'microsoft-id-1',
        email: 'jane@example.com',
        displayName: 'Jane Doe',
        avatar: undefined,
      });
    });

    it('falls back to "Microsoft User" when displayName is missing', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile({ displayName: undefined }), done);
      const [, user] = done.mock.calls[0];
      expect(user?.displayName).toBe('Microsoft User');
    });

    it('sets email to undefined when emails array is missing', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile({ emails: undefined }), done);
      const [, user] = done.mock.calls[0];
      expect(user?.email).toBeUndefined();
    });

    it('calls done with null error on success', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile(), done);
      expect(done.mock.calls[0][0]).toBeNull();
    });
  });
});
