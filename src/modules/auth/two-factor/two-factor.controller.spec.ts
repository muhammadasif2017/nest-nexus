import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorCodeInput } from './dto/two-factor-code.input';
import { JwtPayload } from '../strategies/jwt.strategy';

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

const makeRes = () => ({
  cookie: jest.fn(),
});

const makeReq = () => ({ headers: { 'user-agent': 'test-agent' } });

const makeController = () => {
  const authService = makeAuthServiceMock();
  const tokenService = makeTokenServiceMock();
  const twoFactorService = makeTwoFactorServiceMock();
  const controller = new TwoFactorController(
    authService as any,
    tokenService as any,
    twoFactorService as any,
  );
  return { controller, authService, tokenService, twoFactorService };
};

describe('TwoFactorController', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('verify()', () => {
    const dto: TwoFactorCodeInput = { code: '123456' };
    const user: JwtPayload = {
      sub: 'user-id-1',
      email: 'user@test.com',
      roles: ['user'],
      scope: 'two_factor_pending',
    };

    it('throws UnauthorizedException for a token that is not scope=two_factor_pending', async () => {
      const { controller, twoFactorService, authService } = makeController();
      const fullyAuthedUser: JwtPayload = { ...user, scope: undefined };
      const res = makeRes();
      await expect(
        controller.verify(fullyAuthedUser, dto, makeReq() as any, res as any),
      ).rejects.toThrow(UnauthorizedException);
      expect(twoFactorService.verify).not.toHaveBeenCalled();
      expect(authService.issueTokens).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the code is invalid', async () => {
      const { controller, twoFactorService } = makeController();
      twoFactorService.verify.mockResolvedValue(false);
      const res = makeRes();
      await expect(controller.verify(user, dto, makeReq() as any, res as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does not issue tokens when the code is invalid', async () => {
      const { controller, twoFactorService, authService } = makeController();
      twoFactorService.verify.mockResolvedValue(false);
      const res = makeRes();
      await expect(controller.verify(user, dto, makeReq() as any, res as any)).rejects.toThrow();
      expect(authService.issueTokens).not.toHaveBeenCalled();
    });

    it('issues a full token pair and sets the refresh cookie on success', async () => {
      const { controller, authService, tokenService } = makeController();
      const res = makeRes();
      const result = await controller.verify(user, dto, makeReq() as any, res as any);
      expect(authService.issueTokens).toHaveBeenCalledWith('user-id-1', 'test-agent');
      expect(tokenService.getRefreshTokenCookieOptions).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', cookieOptions);
      expect(result).toBe(mockAuthOutput);
    });
  });
});
