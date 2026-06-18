import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { JwtPayload } from './strategies/jwt.strategy';

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
});

const makeTokenServiceMock = () => ({
  getRefreshTokenCookieOptions: jest.fn().mockReturnValue(cookieOptions),
  getCurrentDeviceId: jest.fn().mockResolvedValue('device-id-1'),
  listDeviceSessions: jest.fn().mockResolvedValue([
    {
      deviceId: 'device-id-1',
      deviceName: 'Windows Device',
      lastUsedAt: new Date(),
      createdAt: new Date(),
      isCurrent: true,
    },
  ]),
  revokeDeviceSession: jest.fn().mockResolvedValue(undefined),
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

const makeController = () => {
  const authService = makeAuthServiceMock();
  const tokenService = makeTokenServiceMock();
  const controller = new AuthController(authService as any, tokenService as any);
  return { controller, authService, tokenService };
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
      await expect(controller.refresh(req as any, res as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does not call authService.refresh when cookie is missing', async () => {
      const { controller, authService } = makeController();
      const req = makeReq({ cookies: {} });
      const res = makeRes();
      await expect(controller.refresh(req as any, res as any)).rejects.toThrow();
      expect(authService.refresh).not.toHaveBeenCalled();
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

  // ── sessions ──────────────────────────────────────────────────────────────────

  describe('listSessions()', () => {
    const user: JwtPayload = { sub: 'user-id-1', email: 'user@test.com', roles: ['user'] };

    it('resolves the current deviceId from the refresh_token cookie', async () => {
      const { controller, tokenService } = makeController();
      const req = makeReq({ cookies: { refresh_token: 'raw-refresh' } });
      await controller.listSessions(user, req as any);
      expect(tokenService.getCurrentDeviceId).toHaveBeenCalledWith('user-id-1', 'raw-refresh');
    });

    it('returns the device session list from TokenService', async () => {
      const { controller, tokenService } = makeController();
      const req = makeReq({ cookies: {} });
      const result = await controller.listSessions(user, req as any);
      expect(tokenService.listDeviceSessions).toHaveBeenCalledWith('user-id-1', 'device-id-1');
      expect(result).toEqual(await tokenService.listDeviceSessions.mock.results[0].value);
    });
  });

  describe('revokeSession()', () => {
    it('revokes the given deviceId scoped to the current user', async () => {
      const { controller, tokenService } = makeController();
      const user: JwtPayload = { sub: 'user-id-1', email: 'user@test.com', roles: ['user'] };
      await controller.revokeSession(user, 'device-to-revoke');
      expect(tokenService.revokeDeviceSession).toHaveBeenCalledWith(
        'user-id-1',
        'device-to-revoke',
      );
    });
  });
});
