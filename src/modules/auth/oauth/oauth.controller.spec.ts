import 'reflect-metadata';
import { OAuthController } from './oauth.controller';
import { OAuthProfile } from './strategies/google.strategy';

const cookieOptions = {
  httpOnly: true,
  secure: false,
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const mockAuthOutput = {
  accessToken: 'access-token',
  user: { id: 'user-id-1', email: 'user@test.com' } as any,
  accessTokenExpiresAt: new Date(),
};

const makeAuthServiceMock = () => ({
  oauthLogin: jest.fn().mockResolvedValue({ auth: mockAuthOutput, refreshToken: 'refresh-token' }),
});

const makeTokenServiceMock = () => ({
  getRefreshTokenCookieOptions: jest.fn().mockReturnValue(cookieOptions),
});

const makeConfigMock = () => ({
  get: jest.fn().mockReturnValue('http://localhost:3000'),
});

const makeRes = () => ({
  cookie: jest.fn(),
  redirect: jest.fn(),
});

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  user: {
    provider: 'google',
    providerId: 'gid-1',
    email: 'oauth@test.com',
    displayName: 'OAuth User',
  } as OAuthProfile,
  headers: { 'user-agent': 'test-agent' },
  ...overrides,
});

const makeController = () => {
  const authService = makeAuthServiceMock();
  const tokenService = makeTokenServiceMock();
  const config = makeConfigMock();
  const controller = new OAuthController(authService as any, tokenService as any, config as any);
  return { controller, authService, tokenService, config };
};

describe('OAuthController', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('googleCallback()', () => {
    it('sets the refresh cookie and redirects to oauth success without token', async () => {
      const { controller, authService, config } = makeController();
      const req = makeReq();
      const res = makeRes();
      await controller.googleCallback(req as any, res as any);
      expect(authService.oauthLogin).toHaveBeenCalledWith(req.user, 'test-agent');
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', cookieOptions);
      expect(config.get).toHaveBeenCalledWith('app.clientOrigin');
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/oauth/success');
    });
  });

  describe('githubCallback()', () => {
    it('sets the refresh cookie and redirects to oauth success without token', async () => {
      const { controller, authService } = makeController();
      const req = makeReq();
      const res = makeRes();
      await controller.githubCallback(req as any, res as any);
      expect(authService.oauthLogin).toHaveBeenCalledWith(req.user, 'test-agent');
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', cookieOptions);
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/oauth/success');
    });
  });
});
