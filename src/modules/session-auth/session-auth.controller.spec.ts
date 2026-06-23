import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionAuthController } from './session-auth.controller';
import { SessionGuard } from './session-auth.guard';
import { SessionLoginInput } from './dto/session-login.input';

const mockAuthOutput = {
  accessToken: 'access-token',
  user: { id: 'user-id-1', email: 'user@test.com' } as any,
  accessTokenExpiresAt: new Date(),
};

const makeAuthServiceMock = () => ({
  login: jest.fn().mockResolvedValue({ auth: mockAuthOutput, refreshToken: 'refresh-token' }),
});

const makeRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  ip: '1.2.3.4',
  headers: { 'user-agent': 'test-agent' },
  session: {
    regenerate: jest.fn((cb: (err?: Error) => void) => cb()),
    destroy: jest.fn((cb: (err?: Error) => void) => cb()),
  },
  ...overrides,
});

const makeController = () => {
  const authService = makeAuthServiceMock();
  const controller = new SessionAuthController(authService as any);
  return { controller, authService };
};

describe('SessionAuthController', () => {
  beforeEach(() => jest.clearAllMocks());

  // Regression test for the bug found while splitting this out of AuthController:
  // logout previously claimed "session guard handles auth" but no guard was ever applied.
  it('applies SessionGuard to logout()', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SessionAuthController.prototype.logout);
    expect(guards).toContain(SessionGuard);
  });

  describe('login()', () => {
    const dto: SessionLoginInput = { email: 'user@test.com', password: 'P@ssw0rd!' };

    it('returns 401 with TWO_FACTOR_REQUIRED when login result is 2FA pending', async () => {
      const { controller, authService } = makeController();
      authService.login.mockResolvedValue({
        auth: { isTwoFactorPending: true, accessToken: 'pending-token' },
        refreshToken: '',
      });
      const req = makeReq();
      const res = makeRes();
      await controller.login(dto, req as any, res as any);
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
      await controller.login(dto, req as any, res as any);
      expect(req.session.regenerate).not.toHaveBeenCalled();
    });

    it('regenerates the session on successful login', async () => {
      const { controller } = makeController();
      const req = makeReq();
      const res = makeRes();
      await controller.login(dto, req as any, res as any);
      expect(req.session.regenerate).toHaveBeenCalled();
    });

    it('stores user and userId in the session on success', async () => {
      const { controller } = makeController();
      const req = makeReq();
      const res = makeRes();
      await controller.login(dto, req as any, res as any);
      expect((req.session as any).user).toEqual(mockAuthOutput.user);
      expect((req.session as any).userId).toBe('user-id-1');
    });

    it('returns a success message and user on success', async () => {
      const { controller } = makeController();
      const req = makeReq();
      const res = makeRes();
      const result = await controller.login(dto, req as any, res as any);
      expect(result).toEqual({ message: 'Logged in successfully.', user: mockAuthOutput.user });
    });
  });

  describe('logout()', () => {
    it('destroys the session', async () => {
      const { controller } = makeController();
      const req = makeReq();
      await controller.logout(req as any);
      expect(req.session.destroy).toHaveBeenCalled();
    });
  });
});
