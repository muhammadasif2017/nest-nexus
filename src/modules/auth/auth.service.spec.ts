import 'reflect-metadata';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';

// ── bcrypt mock ───────────────────────────────────────────────────────────────
jest.mock('bcrypt', () => ({ compare: jest.fn() }));
import * as bcrypt from 'bcrypt';

// ── Factories ─────────────────────────────────────────────────────────────────

const makeUserDoc = (overrides: Record<string, unknown> = {}) => {
  const base = {
    _id: { toString: () => 'user-id-1' },
    email: 'user@test.com',
    displayName: 'Test User',
    roles: ['user'],
    isEmailVerified: false,
    isActive: true,
    password: '$2b$12$hashedpassword',
    refreshTokens: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
  return { ...base, toObject: () => ({ ...base }) };
};

const makeModelMock = () => {
  const exec = jest.fn().mockResolvedValue(null);
  const select = jest.fn().mockReturnValue({ exec });

  return {
    exists: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn().mockReturnValue({ select }),
    findByIdAndUpdate: jest.fn().mockReturnValue({ exec }),
    _exec: exec,
    _select: select,
  };
};

const makeTokenServiceMock = () => ({
  generateAccessToken: jest.fn().mockReturnValue('mock-access-token'),
  generateRefreshToken: jest.fn().mockResolvedValue('mock-refresh-token'),
  revokeAllTokens: jest.fn().mockResolvedValue(undefined),
  rotateRefreshToken: jest.fn().mockResolvedValue({
    accessToken: 'rotated-access',
    refreshToken: 'rotated-refresh',
    userId: 'user-id-1',
  }),
});

const makeConfigMock = () => ({
  get: jest.fn().mockReturnValue('15m'),
});

const makeService = () => {
  const model = makeModelMock();
  const tokenService = makeTokenServiceMock();
  const config = makeConfigMock();
  const service = new AuthService(model as any, tokenService as any, config as any);
  return { service, model, tokenService, config };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── register ────────────────────────────────────────────────────────────────

  describe('register()', () => {
    const dto: RegisterInput = {
      email: 'New@Test.COM',
      displayName: 'New User',
      password: 'P@ssw0rd!',
    };

    it('throws ConflictException when email already exists', async () => {
      const { service, model } = makeService();
      model.exists.mockResolvedValue({ _id: 'existing-id' });

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('checks email in lowercase', async () => {
      const { service, model } = makeService();
      model.exists.mockResolvedValue(null);
      model.create.mockResolvedValue(makeUserDoc());

      await service.register(dto);

      expect(model.exists).toHaveBeenCalledWith({ email: 'new@test.com' });
    });

    it('creates user with lowercased email', async () => {
      const { service, model } = makeService();
      model.exists.mockResolvedValue(null);
      model.create.mockResolvedValue(makeUserDoc());

      await service.register(dto);

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@test.com' }),
      );
    });

    it('does not create user when email exists', async () => {
      const { service, model } = makeService();
      model.exists.mockResolvedValue({ _id: 'existing-id' });

      await expect(service.register(dto)).rejects.toThrow();
      expect(model.create).not.toHaveBeenCalled();
    });

    it('returns auth output with accessToken', async () => {
      const { service, model } = makeService();
      model.exists.mockResolvedValue(null);
      model.create.mockResolvedValue(makeUserDoc());

      const result = await service.register(dto);

      expect(result.auth.accessToken).toBe('mock-access-token');
    });

    it('returns refreshToken', async () => {
      const { service, model } = makeService();
      model.exists.mockResolvedValue(null);
      model.create.mockResolvedValue(makeUserDoc());

      const result = await service.register(dto);

      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('returns user output inside auth', async () => {
      const { service, model } = makeService();
      model.exists.mockResolvedValue(null);
      model.create.mockResolvedValue(makeUserDoc());

      const result = await service.register(dto);

      expect(result.auth.user).toBeDefined();
      expect(result.auth.user.email).toBe('user@test.com');
    });

    it('accessTokenExpiresAt is a Date', async () => {
      const { service, model } = makeService();
      model.exists.mockResolvedValue(null);
      model.create.mockResolvedValue(makeUserDoc());

      const result = await service.register(dto);

      expect(result.auth.accessTokenExpiresAt).toBeInstanceOf(Date);
    });

    it('calls generateAccessToken with the user document', async () => {
      const { service, model, tokenService } = makeService();
      model.exists.mockResolvedValue(null);
      const userDoc = makeUserDoc();
      model.create.mockResolvedValue(userDoc);

      await service.register(dto);

      expect(tokenService.generateAccessToken).toHaveBeenCalledWith(userDoc);
    });

    it('calls generateRefreshToken with the user id', async () => {
      const { service, model, tokenService } = makeService();
      model.exists.mockResolvedValue(null);
      model.create.mockResolvedValue(makeUserDoc());

      await service.register(dto);

      expect(tokenService.generateRefreshToken).toHaveBeenCalledWith('user-id-1');
    });
  });

  // ── login ────────────────────────────────────────────────────────────────────

  describe('login()', () => {
    const dto: LoginInput = { email: 'User@Test.COM', password: 'P@ssw0rd!' };

    it('queries with lowercased email', async () => {
      const { service, model } = makeService();
      const user = makeUserDoc();
      model._exec.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login(dto);

      expect(model.findOne).toHaveBeenCalledWith({ email: 'user@test.com' });
    });

    it('selects +password field', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeUserDoc());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login(dto);

      expect(model._select).toHaveBeenCalledWith('+password');
    });

    it('throws UnauthorizedException when user not found', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('still calls bcrypt.compare when user not found (timing attack prevention)', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow();

      expect(bcrypt.compare).toHaveBeenCalled();
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeUserDoc());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('error message does not reveal whether email exists', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow('Invalid email or password.');
    });

    it('throws ForbiddenException for deactivated account', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeUserDoc({ isActive: false }));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(dto)).rejects.toThrow(ForbiddenException);
    });

    it('returns auth output on success', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeUserDoc());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result.auth.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('returns user inside auth on success', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeUserDoc());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result.auth.user).toBeDefined();
    });

    it('fires lastLoginAt update without blocking response', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeUserDoc());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto, '1.2.3.4');

      // Result returned successfully — fire-and-forget did not block
      expect(result).toBeDefined();
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ lastLoginIp: '1.2.3.4' }) }),
      );
    });

    it('accessTokenExpiresAt is a Date', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeUserDoc());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result.auth.accessTokenExpiresAt).toBeInstanceOf(Date);
    });
  });

  // ── logout ────────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('delegates to tokenService.revokeAllTokens', async () => {
      const { service, tokenService } = makeService();

      await service.logout('user-id-1');

      expect(tokenService.revokeAllTokens).toHaveBeenCalledWith('user-id-1');
    });

    it('resolves without returning a value', async () => {
      const { service } = makeService();

      const result = await service.logout('user-id-1');

      expect(result).toBeUndefined();
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('delegates to tokenService.rotateRefreshToken', async () => {
      const { service, tokenService } = makeService();

      await service.refresh('old-refresh-token');

      expect(tokenService.rotateRefreshToken).toHaveBeenCalledWith('old-refresh-token');
    });

    it('returns new accessToken', async () => {
      const { service } = makeService();

      const result = await service.refresh('old-refresh-token');

      expect(result.auth.accessToken).toBe('rotated-access');
    });

    it('returns new refreshToken', async () => {
      const { service } = makeService();

      const result = await service.refresh('old-refresh-token');

      expect(result.refreshToken).toBe('rotated-refresh');
    });

    it('accessTokenExpiresAt is a Date', async () => {
      const { service } = makeService();

      const result = await service.refresh('old-refresh-token');

      expect(result.auth.accessTokenExpiresAt).toBeInstanceOf(Date);
    });

    it('reads jwt.expiresIn from config', async () => {
      const { service, config } = makeService();

      await service.refresh('old-refresh-token');

      expect(config.get).toHaveBeenCalledWith('jwt.expiresIn');
    });
  });

  // ── parseExpiresIn (via refresh) ─────────────────────────────────────────────

  describe('parseExpiresIn() — via refresh()', () => {
    const testExpiry = async (expiresIn: string) => {
      const { service, config } = makeService();
      config.get.mockReturnValue(expiresIn);
      const before = Date.now();
      const result = await service.refresh('token');
      const after = Date.now();
      return { expiresAt: result.auth.accessTokenExpiresAt as Date, before, after };
    };

    it('parses minutes — expiresAt ~15m in future', async () => {
      const { expiresAt, before } = await testExpiry('15m');
      const diff = expiresAt.getTime() - before;
      expect(diff).toBeGreaterThanOrEqual(15 * 60 * 1000 - 50);
      expect(diff).toBeLessThanOrEqual(15 * 60 * 1000 + 50);
    });

    it('parses seconds — expiresAt ~30s in future', async () => {
      const { expiresAt, before } = await testExpiry('30s');
      const diff = expiresAt.getTime() - before;
      expect(diff).toBeGreaterThanOrEqual(30 * 1000 - 50);
      expect(diff).toBeLessThanOrEqual(30 * 1000 + 50);
    });

    it('parses hours — expiresAt ~1h in future', async () => {
      const { expiresAt, before } = await testExpiry('1h');
      const diff = expiresAt.getTime() - before;
      expect(diff).toBeGreaterThanOrEqual(60 * 60 * 1000 - 50);
      expect(diff).toBeLessThanOrEqual(60 * 60 * 1000 + 50);
    });

    it('parses days — expiresAt ~7d in future', async () => {
      const { expiresAt, before } = await testExpiry('7d');
      const diff = expiresAt.getTime() - before;
      expect(diff).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 50);
      expect(diff).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 50);
    });

    it('falls back to 15m for invalid format', async () => {
      const { expiresAt, before } = await testExpiry('invalid');
      const diff = expiresAt.getTime() - before;
      expect(diff).toBeGreaterThanOrEqual(15 * 60 * 1000 - 50);
      expect(diff).toBeLessThanOrEqual(15 * 60 * 1000 + 50);
    });
  });
});
