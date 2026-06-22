import 'reflect-metadata';
import { WebauthnController } from './webauthn.controller';
import { JwtPayload } from '../strategies/jwt.strategy';

const mockAuthOutput = {
  accessToken: 'access-token',
  user: { id: 'user-id-1', email: 'user@test.com' } as any,
  accessTokenExpiresAt: new Date(),
};

const makeAuthServiceMock = () => ({
  issueTokens: jest.fn().mockResolvedValue({ auth: mockAuthOutput, refreshToken: 'refresh-token' }),
});

const makeTokenServiceMock = () => ({
  getRefreshTokenCookieOptions: jest.fn().mockReturnValue({ httpOnly: true }),
});

const makeWebauthnServiceMock = () => ({
  registerOptions: jest.fn(),
  registerVerify: jest.fn(),
  loginOptions: jest.fn(),
  loginVerify: jest.fn(),
  deleteCredential: jest.fn(),
});

const makeRes = () => ({ cookie: jest.fn() });

const makeController = () => {
  const authService = makeAuthServiceMock();
  const tokenService = makeTokenServiceMock();
  const webauthnService = makeWebauthnServiceMock();
  const controller = new WebauthnController(
    authService as any,
    tokenService as any,
    webauthnService as any,
  );
  return { controller, authService, tokenService, webauthnService };
};

const user: JwtPayload = { sub: 'user-id-1', email: 'user@test.com', roles: ['user'] };

describe('WebauthnController', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('registerOptions()', () => {
    it('delegates to WebauthnService scoped to the current user', async () => {
      const { controller, webauthnService } = makeController();
      webauthnService.registerOptions.mockResolvedValue({ challenge: 'reg-challenge' });
      const result = await controller.registerOptions(user);
      expect(webauthnService.registerOptions).toHaveBeenCalledWith('user-id-1', 'user@test.com');
      expect(result).toEqual({ challenge: 'reg-challenge' });
    });
  });

  describe('registerVerify()', () => {
    it('delegates to WebauthnService scoped to the current user', async () => {
      const { controller, webauthnService } = makeController();
      const dto = { response: { id: 'cred-1' } as any };
      await controller.registerVerify(user, dto);
      expect(webauthnService.registerVerify).toHaveBeenCalledWith('user-id-1', dto.response);
    });
  });

  describe('loginOptions()', () => {
    it('delegates to WebauthnService with the provided email', async () => {
      const { controller, webauthnService } = makeController();
      webauthnService.loginOptions.mockResolvedValue({ challenge: 'login-challenge' });
      const result = await controller.loginOptions({ email: 'alice@test.com' });
      expect(webauthnService.loginOptions).toHaveBeenCalledWith('alice@test.com');
      expect(result).toEqual({ challenge: 'login-challenge' });
    });
  });

  describe('loginVerify()', () => {
    it('issues a full token pair and sets the refresh cookie on success', async () => {
      const { controller, webauthnService, authService, tokenService } = makeController();
      webauthnService.loginVerify.mockResolvedValue('user-id-1');
      const res = makeRes();
      const dto = { email: 'alice@test.com', response: { id: 'cred-1' } as any };
      const result = await controller.loginVerify(dto, res as any);
      expect(webauthnService.loginVerify).toHaveBeenCalledWith('alice@test.com', dto.response);
      expect(authService.issueTokens).toHaveBeenCalledWith('user-id-1');
      expect(tokenService.getRefreshTokenCookieOptions).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', { httpOnly: true });
      expect(result).toBe(mockAuthOutput);
    });
  });

  describe('deleteCredential()', () => {
    it('delegates to WebauthnService scoped to the current user', async () => {
      const { controller, webauthnService } = makeController();
      await controller.deleteCredential(user);
      expect(webauthnService.deleteCredential).toHaveBeenCalledWith('user-id-1');
    });
  });
});
