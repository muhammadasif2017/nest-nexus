import 'reflect-metadata';
import { MagicLinkController } from './magic-link.controller';
import { MagicLinkSendInput, MagicLinkVerifyInput } from './dto/magic-link.input';

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

const makeMagicLinkServiceMock = () => ({
  send: jest.fn().mockResolvedValue(undefined),
  verify: jest.fn().mockResolvedValue('user-id-1'),
});

const makeRes = () => ({
  cookie: jest.fn(),
});

const makeController = () => {
  const authService = makeAuthServiceMock();
  const tokenService = makeTokenServiceMock();
  const magicLinkService = makeMagicLinkServiceMock();
  const controller = new MagicLinkController(authService as any, tokenService as any, magicLinkService as any);
  return { controller, authService, tokenService, magicLinkService };
};

describe('MagicLinkController', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('send()', () => {
    it('always returns the generic success message', async () => {
      const { controller, magicLinkService } = makeController();
      const dto: MagicLinkSendInput = { email: 'user@test.com' };
      const result = await controller.send(dto);
      expect(magicLinkService.send).toHaveBeenCalledWith('user@test.com');
      expect(result).toEqual({
        message: 'If an account with this email exists, a login link has been sent.',
      });
    });
  });

  describe('verify()', () => {
    it('sets the refresh cookie and returns auth on success', async () => {
      const { controller, magicLinkService, authService, tokenService } = makeController();
      const dto: MagicLinkVerifyInput = { token: 'raw-token' };
      const res = makeRes();
      const result = await controller.verify(dto, res as any);
      expect(magicLinkService.verify).toHaveBeenCalledWith('raw-token');
      expect(authService.issueTokens).toHaveBeenCalledWith('user-id-1');
      expect(tokenService.getRefreshTokenCookieOptions).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', cookieOptions);
      expect(result).toBe(mockAuthOutput);
    });
  });
});
