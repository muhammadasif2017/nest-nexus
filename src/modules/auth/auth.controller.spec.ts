import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LoginInput } from './dto/login.input';
import { TwoFactorCodeInput, MagicLinkSendInput, MagicLinkVerifyInput } from './dto/two-factor.input';
import { JwtPayload } from './strategies/jwt.strategy';
import { OAuthProfile } from './strategies/google.strategy';

// ── Factories ─────────────────────────────────────────────────────────────────

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
  register: jest.fn(),
  login: jest.fn().mockResolvedValue({ auth: mockAuthOutput, refreshToken: 'refresh-token' }),
  refresh: jest.fn(),
  logout: jest.fn().mockResolvedValue(undefined),
  oauthLogin: jest.fn().mockResolvedValue({ auth: mockAuthOutput, refreshToken: 'refresh-token' }),
  issueTokens: jest.fn().mockResolvedValue({ auth: mockAuthOutput, refreshToken: 'refresh-token' }),
});

const makeTokenServiceMock = () => ({
  getRefreshTokenCookieOptions: jest.fn().mockReturnValue(cookieOptions),
});

const makeTwoFactorServiceMock = () => ({
  setup: jest.fn(),
  enable: jest.fn(),
  disable: jest.fn(),
  verify: jest.fn().mockResolvedValue(true),
});

const makeMagicLinkServiceMock = () => ({
  send: jest.fn().mockResolvedValue(undefined),
  verify: jest.fn().mockResolvedValue('user-id-1'),
});

const makeConfigMock = () => ({
  get: jest.fn().mockReturnValue('http://localhost:3000'),
});

const makeRes = () => ({
  cookie: jest.fn(),
  clearCookie: jest.fn(),
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
  redirect: jest.fn(),
});

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  ip: '1.2.3.4',
  cookies: {},
  session: {
    regenerate: jest.fn((cb: (err?: Error) => void) => cb()),
    destroy: jest.fn((cb: (err?: Error) => void) => cb()),
  },
  user: {
    provider: 'google',
    providerId: 'gid-1',
    email: 'oauth@test.com',
    displayName: 'OAuth User',
  } as OAuthProfile,
  ...overrides,
});

const makeController = () => {
  const authService = makeAuthServiceMock();
  const tokenService = makeTokenServiceMock();
  const twoFactorService = makeTwoFactorServiceMock();
  const magicLinkService = makeMagicLinkServiceMock();
  const config = makeConfigMock();
  const controller = new AuthController(
    authService as any,
    tokenService as any,
    twoFactorService as any,
    magicLinkService as any,
    config as any,
  );
  return { controller, authService, tokenService, twoFactorService, magicLinkService, config };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('AuthController', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── refresh ───────────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('throws UnauthorizedException when refresh_token cookie is missing', async () => {
      const { controller } = makeController();
      const req = makeReq({ cookies: {} });
      const res = makeRes();
      await expect(controller.refresh(req as any, res as any)).rejects.toThrow(UnauthorizedException);
    });

    it('does not call authService.refresh when cookie is missing', async () => {
      const { controller, authService } = makeController();
      const req = makeReq({ cookies: {} });
      const res = makeRes();
      await expect(controller.refresh(req as any, res as any)).rejects.toThrow();
      expect(authService.refresh).not.toHaveBeenCalled();
    });
  });

  // ── session/login ─────────────────────────────────────────────────────────────

  describe('sessionLogin()', () => {
    const dto: LoginInput = { email: 'user@test.com', password: 'P@ssw0rd!' };

    it('returns 401 with TWO_FACTOR_REQUIRED when login result is 2FA pending', async () => {
      const { controller, authService } = makeController();
      authService.login.mockResolvedValue({
        auth: { isTwoFactorPending: true, accessToken: 'pending-token' },
        refreshToken: '',
      });
      const req = makeReq();
      const res = makeRes();
      await controller.sessionLogin(dto, req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: 'TWO_FACTOR_REQUIRED' }),
      );
    });

    it('does not regenerate session when 2FA pending', async () => {
      const { controller, authService } = makeController();
      authService.login.mockResolvedValue({
        auth: { isTwoFactorPending: true, accessToken: 'pending-token' },
        refreshToken: '',
      });
      const req = makeReq();
      const res = makeRes();
      await controller.sessionLogin(dto, req as any, res as any);
      expect(req.session.regenerate).not.toHaveBeenCalled();
    });

    it('regenerates the session on successful login', async () => {
      const { controller } = makeController();
      const req = makeReq();
      const res = makeRes();
      await controller.sessionLogin(dto, req as any, res as any);
      expect(req.session.regenerate).toHaveBeenCalled();
    });

    it('stores user and userId in the session on success', async () => {
      const { controller } = makeController();
      const req = makeReq();
      const res = makeRes();
      await controller.sessionLogin(dto, req as any, res as any);
      expect((req.session as any).user).toEqual(mockAuthOutput.user);
      expect((req.session as any).userId).toBe('user-id-1');
    });

    it('returns a success message and user on success', async () => {
      const { controller } = makeController();
      const req = makeReq();
      const res = makeRes();
      const result = await controller.sessionLogin(dto, req as any, res as any);
      expect(result).toEqual({ message: 'Logged in successfully.', user: mockAuthOutput.user });
    });
  });

  // ── session/logout ────────────────────────────────────────────────────────────

  describe('sessionLogout()', () => {
    it('destroys the session', async () => {
      const { controller } = makeController();
      const req = makeReq();
      await controller.sessionLogout(req as any);
      expect(req.session.destroy).toHaveBeenCalled();
    });
  });

  // ── me ────────────────────────────────────────────────────────────────────────

  describe('getMe()', () => {
    it('returns the current user JWT payload', async () => {
      const { controller } = makeController();
      const user: JwtPayload = { sub: 'user-id-1', email: 'user@test.com', roles: ['user'] };
      const result = await controller.getMe(user);
      expect(result).toBe(user);
    });
  });

  // ── 2fa/verify ────────────────────────────────────────────────────────────────

  describe('verify2fa()', () => {
    const dto: TwoFactorCodeInput = { code: '123456' };
    const user: JwtPayload = { sub: 'user-id-1', email: 'user@test.com', roles: ['user'], scope: 'two_factor_pending' };

    it('throws UnauthorizedException when the code is invalid', async () => {
      const { controller, twoFactorService } = makeController();
      twoFactorService.verify.mockResolvedValue(false);
      const res = makeRes();
      await expect(controller.verify2fa(user, dto, res as any)).rejects.toThrow(UnauthorizedException);
    });

    it('does not issue tokens when the code is invalid', async () => {
      const { controller, twoFactorService, authService } = makeController();
      twoFactorService.verify.mockResolvedValue(false);
      const res = makeRes();
      await expect(controller.verify2fa(user, dto, res as any)).rejects.toThrow();
      expect(authService.issueTokens).not.toHaveBeenCalled();
    });

    it('issues a full token pair and sets the refresh cookie on success', async () => {
      const { controller, authService, tokenService } = makeController();
      const res = makeRes();
      const result = await controller.verify2fa(user, dto, res as any);
      expect(authService.issueTokens).toHaveBeenCalledWith('user-id-1');
      expect(tokenService.getRefreshTokenCookieOptions).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', cookieOptions);
      expect(result).toBe(mockAuthOutput);
    });
  });

  // ── magic-link/send ───────────────────────────────────────────────────────────

  describe('sendMagicLink()', () => {
    it('always returns the generic success message', async () => {
      const { controller, magicLinkService } = makeController();
      const dto: MagicLinkSendInput = { email: 'user@test.com' };
      const result = await controller.sendMagicLink(dto);
      expect(magicLinkService.send).toHaveBeenCalledWith('user@test.com');
      expect(result).toEqual({
        message: 'If an account with this email exists, a login link has been sent.',
      });
    });
  });

  // ── magic-link/verify ─────────────────────────────────────────────────────────

  describe('verifyMagicLink()', () => {
    it('sets the refresh cookie and returns auth on success', async () => {
      const { controller, magicLinkService, authService, tokenService } = makeController();
      const dto: MagicLinkVerifyInput = { token: 'raw-token' };
      const res = makeRes();
      const result = await controller.verifyMagicLink(dto, res as any);
      expect(magicLinkService.verify).toHaveBeenCalledWith('raw-token');
      expect(authService.issueTokens).toHaveBeenCalledWith('user-id-1');
      expect(tokenService.getRefreshTokenCookieOptions).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', cookieOptions);
      expect(result).toBe(mockAuthOutput);
    });
  });

  // ── OAuth callbacks ───────────────────────────────────────────────────────────

  describe('googleCallback()', () => {
    it('sets the refresh cookie and redirects with the access token fragment', async () => {
      const { controller, authService, config } = makeController();
      const req = makeReq();
      const res = makeRes();
      await controller.googleCallback(req as any, res as any);
      expect(authService.oauthLogin).toHaveBeenCalledWith(req.user);
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', cookieOptions);
      expect(config.get).toHaveBeenCalledWith('app.clientOrigin');
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/oauth/success#token=access-token');
    });
  });

  describe('githubCallback()', () => {
    it('sets the refresh cookie and redirects with the access token fragment', async () => {
      const { controller, authService } = makeController();
      const req = makeReq();
      const res = makeRes();
      await controller.githubCallback(req as any, res as any);
      expect(authService.oauthLogin).toHaveBeenCalledWith(req.user);
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', cookieOptions);
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/oauth/success#token=access-token');
    });
  });
});
