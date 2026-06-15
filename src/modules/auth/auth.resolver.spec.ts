import 'reflect-metadata';
import { AuthResolver } from './auth.resolver';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';

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
  register: jest.fn().mockResolvedValue({ auth: mockAuthOutput, refreshToken: 'refresh-token' }),
  login: jest.fn().mockResolvedValue({ auth: mockAuthOutput, refreshToken: 'refresh-token' }),
  logout: jest.fn().mockResolvedValue(undefined),
  refresh: jest.fn().mockResolvedValue({ auth: mockAuthOutput, refreshToken: 'new-refresh-token' }),
});

const makeTokenServiceMock = () => ({
  getRefreshTokenCookieOptions: jest.fn().mockReturnValue(cookieOptions),
});

const makeRes = () => ({
  cookie: jest.fn(),
  clearCookie: jest.fn(),
});

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  ip: '1.2.3.4',
  cookies: {},
  ...overrides,
});

const makeResolver = () => {
  const authService = makeAuthServiceMock();
  const tokenService = makeTokenServiceMock();
  const resolver = new AuthResolver(authService as any, tokenService as any);
  return { resolver, authService, tokenService };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('AuthResolver', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── register ────────────────────────────────────────────────────────────────

  describe('register()', () => {
    const input: RegisterInput = {
      email: 'new@test.com',
      displayName: 'New User',
      password: 'P@ssw0rd!',
    };

    it('calls authService.register with input', async () => {
      const { resolver, authService } = makeResolver();
      const res = makeRes();

      await resolver.register(input, { res } as any);

      expect(authService.register).toHaveBeenCalledWith(input);
    });

    it('sets refresh_token cookie with returned token', async () => {
      const { resolver } = makeResolver();
      const res = makeRes();

      await resolver.register(input, { res } as any);

      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', cookieOptions);
    });

    it('uses tokenService.getRefreshTokenCookieOptions for cookie settings', async () => {
      const { resolver, tokenService } = makeResolver();
      const res = makeRes();

      await resolver.register(input, { res } as any);

      expect(tokenService.getRefreshTokenCookieOptions).toHaveBeenCalled();
    });

    it('returns auth output (not the refreshToken)', async () => {
      const { resolver } = makeResolver();
      const res = makeRes();

      const result = await resolver.register(input, { res } as any);

      expect(result).toBe(mockAuthOutput);
      expect((result as any).refreshToken).toBeUndefined();
    });
  });

  // ── login ────────────────────────────────────────────────────────────────────

  describe('login()', () => {
    const input: LoginInput = { email: 'user@test.com', password: 'P@ssw0rd!' };

    it('calls authService.login with input and req.ip', async () => {
      const { resolver, authService } = makeResolver();
      const res = makeRes();
      const req = makeReq({ ip: '9.8.7.6' });

      await resolver.login(input, { req, res } as any);

      expect(authService.login).toHaveBeenCalledWith(input, '9.8.7.6');
    });

    it('sets refresh_token cookie', async () => {
      const { resolver } = makeResolver();
      const res = makeRes();

      await resolver.login(input, { req: makeReq(), res } as any);

      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', cookieOptions);
    });

    it('returns auth output', async () => {
      const { resolver } = makeResolver();
      const res = makeRes();

      const result = await resolver.login(input, { req: makeReq(), res } as any);

      expect(result).toBe(mockAuthOutput);
    });
  });

  // ── refreshTokens ─────────────────────────────────────────────────────────────

  describe('refreshTokens()', () => {
    it('throws when refresh_token cookie is absent', async () => {
      const { resolver } = makeResolver();
      const req = makeReq({ cookies: {} });
      const res = makeRes();

      await expect(resolver.refreshTokens({ req, res } as any)).rejects.toThrow(
        'No refresh token provided.',
      );
    });

    it('reads token from req.cookies.refresh_token', async () => {
      const { resolver, authService } = makeResolver();
      const req = makeReq({ cookies: { refresh_token: 'stored-refresh-token' } });
      const res = makeRes();

      await resolver.refreshTokens({ req, res } as any);

      expect(authService.refresh).toHaveBeenCalledWith('stored-refresh-token');
    });

    it('sets rotated cookie with new refresh token', async () => {
      const { resolver } = makeResolver();
      const req = makeReq({ cookies: { refresh_token: 'old-token' } });
      const res = makeRes();

      await resolver.refreshTokens({ req, res } as any);

      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'new-refresh-token', cookieOptions);
    });

    it('returns auth output', async () => {
      const { resolver } = makeResolver();
      const req = makeReq({ cookies: { refresh_token: 'token' } });
      const res = makeRes();

      const result = await resolver.refreshTokens({ req, res } as any);

      expect(result).toBe(mockAuthOutput);
    });

    it('does not call authService.refresh when cookie is missing', async () => {
      const { resolver, authService } = makeResolver();
      const req = makeReq({ cookies: {} });
      const res = makeRes();

      await expect(resolver.refreshTokens({ req, res } as any)).rejects.toThrow();

      expect(authService.refresh).not.toHaveBeenCalled();
    });
  });

  // ── logout ────────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    const user = { sub: 'user-id-1', email: 'user@test.com', roles: ['user'] };

    it('calls authService.logout with user.sub', async () => {
      const { resolver, authService } = makeResolver();
      const res = makeRes();

      await resolver.logout(user, { res } as any);

      expect(authService.logout).toHaveBeenCalledWith('user-id-1');
    });

    it('clears the refresh_token cookie', async () => {
      const { resolver } = makeResolver();
      const res = makeRes();

      await resolver.logout(user, { res } as any);

      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', cookieOptions);
    });

    it('uses tokenService.getRefreshTokenCookieOptions for clearCookie', async () => {
      const { resolver, tokenService } = makeResolver();
      const res = makeRes();

      await resolver.logout(user, { res } as any);

      expect(tokenService.getRefreshTokenCookieOptions).toHaveBeenCalled();
    });

    it('returns true', async () => {
      const { resolver } = makeResolver();
      const res = makeRes();

      const result = await resolver.logout(user, { res } as any);

      expect(result).toBe(true);
    });
  });
});
