import { ConfigService } from '@nestjs/config';
import { GithubStrategy } from './github.strategy';

const makeConfigMock = () => ({
  get: jest.fn().mockReturnValue('config-value'),
});

const makeStrategy = () => new GithubStrategy(makeConfigMock() as unknown as ConfigService);

const makeProfile = (overrides: Record<string, unknown> = {}) => ({
  id: 'github-id-1',
  username: 'janedoe',
  displayName: 'Jane Doe',
  emails: [{ value: 'jane@example.com' }],
  photos: [{ value: 'https://example.com/avatar.png' }],
  ...overrides,
});

describe('GithubStrategy', () => {
  describe('validate()', () => {
    it('maps profile to OAuthProfile shape with provider "github"', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('access', 'refresh', makeProfile(), done);
      expect(done).toHaveBeenCalledWith(null, {
        provider: 'github',
        providerId: 'github-id-1',
        email: 'jane@example.com',
        displayName: 'Jane Doe',
        avatar: 'https://example.com/avatar.png',
      });
    });

    it('falls back to username when displayName is missing', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile({ displayName: undefined }), done);
      const [, user] = done.mock.calls[0];
      expect(user?.displayName).toBe('janedoe');
    });

    it('falls back to "GitHub User" when both displayName and username are missing', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate(
        'a',
        'r',
        makeProfile({ displayName: undefined, username: undefined }),
        done,
      );
      const [, user] = done.mock.calls[0];
      expect(user?.displayName).toBe('GitHub User');
    });

    it('sets email to undefined when emails array is missing', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile({ emails: undefined }), done);
      const [, user] = done.mock.calls[0];
      expect(user?.email).toBeUndefined();
    });

    it('sets avatar to undefined when photos array is missing', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile({ photos: undefined }), done);
      const [, user] = done.mock.calls[0];
      expect(user?.avatar).toBeUndefined();
    });

    it('calls done with null error on success', () => {
      const strategy = makeStrategy();
      const done = jest.fn();
      strategy.validate('a', 'r', makeProfile(), done);
      expect(done.mock.calls[0][0]).toBeNull();
    });
  });
});
