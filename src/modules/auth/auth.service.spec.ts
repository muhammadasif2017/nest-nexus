import 'reflect-metadata';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';

// ── bcrypt mock ───────────────────────────────────────────────────────────────
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

const bcryptCompare = bcrypt.compare as jest.Mock;
const bcryptHash = bcrypt.hash as jest.Mock;

// ── Factories ─────────────────────────────────────────────────────────────────

const makeUserDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-id-1',
  email: 'user@test.com',
  displayName: 'Test User',
  roles: ['user'],
  isEmailVerified: false,
  isActive: true,
  isTwoFactorEnabled: false,
  avatarUrl: null,
  password: '$2b$12$hashedpassword',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  lastLoginAt: null,
  ...overrides,
});

const makePrismaMock = () => ({
  user: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(makeUserDoc()),
    update: jest.fn().mockResolvedValue(makeUserDoc()),
  },
  oauthProvider: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
});

const makeTokenServiceMock = () => ({
  generateAccessToken: jest.fn().mockReturnValue('mock-access-token'),
  generateRefreshToken: jest.fn().mockResolvedValue('mock-refresh-token'),
  generatePendingTwoFactorToken: jest.fn().mockReturnValue('mock-pending-token'),
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

const makeEventEmitterMock = () => ({ emit: jest.fn() });

const makeService = () => {
  const prisma = makePrismaMock();
  const tokenService = makeTokenServiceMock();
  const config = makeConfigMock();
  const eventEmitter = makeEventEmitterMock();
  const service = new AuthService(
    prisma as unknown as PrismaService,
    tokenService as any,
    config as unknown as ConfigService,
    eventEmitter as unknown as EventEmitter2,
  );
  return { service, prisma, tokenService, config, eventEmitter };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bcryptHash.mockResolvedValue('hashed-password');
  });

  // ── register ────────────────────────────────────────────────────────────────

  describe('register()', () => {
    const dto: RegisterInput = {
      email: 'New@Test.COM',
      displayName: 'New User',
      password: 'P@ssw0rd!',
    };

    it('throws ConflictException when email already exists', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-id' });
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('checks email in lowercase via findUnique', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      await service.register(dto);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'new@test.com' } }),
      );
    });

    it('creates user with lowercased email', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      await service.register(dto);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'new@test.com' }) }),
      );
    });

    it('hashes password before creating user', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      await service.register(dto);
      expect(bcryptHash).toHaveBeenCalledWith('P@ssw0rd!', 12);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ password: 'hashed-password' }) }),
      );
    });

    it('does not create user when email exists', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-id' });
      await expect(service.register(dto)).rejects.toThrow();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('returns auth output with accessToken', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.register(dto);
      expect(result.auth.accessToken).toBe('mock-access-token');
    });

    it('returns refreshToken', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.register(dto);
      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('returns user output inside auth', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.register(dto);
      expect(result.auth.user).toBeDefined();
      expect(result.auth.user.email).toBe('user@test.com');
    });

    it('accessTokenExpiresAt is a Date', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.register(dto);
      expect(result.auth.accessTokenExpiresAt).toBeInstanceOf(Date);
    });

    it('calls generateAccessToken with the created user', async () => {
      const { service, prisma, tokenService } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      const userDoc = makeUserDoc();
      prisma.user.create.mockResolvedValue(userDoc);
      await service.register(dto);
      expect(tokenService.generateAccessToken).toHaveBeenCalledWith(userDoc);
    });

    it('calls generateRefreshToken with the user id', async () => {
      const { service, prisma, tokenService } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      await service.register(dto);
      expect(tokenService.generateRefreshToken).toHaveBeenCalledWith('user-id-1', {
        userAgent: undefined,
      });
    });
  });

  // ── login ────────────────────────────────────────────────────────────────────

  describe('login()', () => {
    const dto: LoginInput = { email: 'User@Test.COM', password: 'P@ssw0rd!' };

    it('queries with lowercased email', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUserDoc());
      bcryptCompare.mockResolvedValue(true);
      await service.login(dto);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'user@test.com' } }),
      );
    });

    it('throws UnauthorizedException when user not found', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      bcryptCompare.mockResolvedValue(false);
      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('still calls bcrypt.compare when user not found (timing attack prevention)', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      bcryptCompare.mockResolvedValue(false);
      await expect(service.login(dto)).rejects.toThrow();
      expect(bcryptCompare).toHaveBeenCalled();
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUserDoc());
      bcryptCompare.mockResolvedValue(false);
      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('error message does not reveal whether email exists', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      bcryptCompare.mockResolvedValue(false);
      await expect(service.login(dto)).rejects.toThrow('Invalid email or password.');
    });

    it('throws ForbiddenException for deactivated account', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUserDoc({ isActive: false }));
      bcryptCompare.mockResolvedValue(true);
      await expect(service.login(dto)).rejects.toThrow(ForbiddenException);
    });

    it('returns auth output on success', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUserDoc());
      bcryptCompare.mockResolvedValue(true);
      const result = await service.login(dto);
      expect(result.auth.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('returns user inside auth on success', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUserDoc());
      bcryptCompare.mockResolvedValue(true);
      const result = await service.login(dto);
      expect(result.auth.user).toBeDefined();
    });

    it('fires lastLoginAt update without blocking response', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUserDoc());
      bcryptCompare.mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(makeUserDoc());
      const result = await service.login(dto, '1.2.3.4');
      expect(result).toBeDefined();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-id-1' },
          data: expect.objectContaining({ lastLoginIp: '1.2.3.4' }),
        }),
      );
    });

    it('accessTokenExpiresAt is a Date', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUserDoc());
      bcryptCompare.mockResolvedValue(true);
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

  // ── oauthLogin ────────────────────────────────────────────────────────────────

  describe('oauthLogin()', () => {
    const profile = {
      provider: 'google',
      providerId: 'gid-123',
      email: 'oauth@test.com',
      displayName: 'OAuth User',
    };

    const makeP2025 = () =>
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '7.0.0',
      });

    const makeP2002 = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '7.0.0',
      });

    it('returns auth when existing OAuth provider link found', async () => {
      const { service, prisma } = makeService();
      prisma.oauthProvider.findUnique.mockResolvedValue({ user: makeUserDoc() });
      const result = await service.oauthLogin(profile);
      expect(result.auth.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('skips user.update and user.create when existing provider found', async () => {
      const { service, prisma } = makeService();
      prisma.oauthProvider.findUnique.mockResolvedValue({ user: makeUserDoc() });
      await service.oauthLogin(profile);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('links OAuth to existing email-matched account when no provider link exists', async () => {
      const { service, prisma } = makeService();
      prisma.oauthProvider.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(makeUserDoc());
      const result = await service.oauthLogin(profile);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'oauth@test.com' } }),
      );
      expect(result.auth.accessToken).toBe('mock-access-token');
    });

    it('creates new user when user.update throws P2025 (no matching email)', async () => {
      const { service, prisma } = makeService();
      prisma.oauthProvider.findUnique.mockResolvedValue(null);
      prisma.user.update.mockRejectedValue(makeP2025());
      prisma.user.create.mockResolvedValue(makeUserDoc());
      const result = await service.oauthLogin(profile);
      expect(prisma.user.create).toHaveBeenCalled();
      expect(result.auth.accessToken).toBe('mock-access-token');
    });

    it('creates new user with generated email when profile has no email', async () => {
      const { service, prisma } = makeService();
      const noEmailProfile = { provider: 'github', providerId: 'ghid-456', displayName: 'GH User' };
      prisma.oauthProvider.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(makeUserDoc());
      await service.oauthLogin(noEmailProfile);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'ghid-456@github.oauth' }),
        }),
      );
    });

    it('emits user.created event when new user is created', async () => {
      const { service, prisma, eventEmitter } = makeService();
      prisma.oauthProvider.findUnique.mockResolvedValue(null);
      prisma.user.update.mockRejectedValue(makeP2025());
      prisma.user.create.mockResolvedValue(makeUserDoc());
      await service.oauthLogin(profile);
      expect(eventEmitter.emit).toHaveBeenCalledWith('user.created', { userId: 'user-id-1' });
    });

    it('does not emit user.created when existing provider link found', async () => {
      const { service, prisma, eventEmitter } = makeService();
      prisma.oauthProvider.findUnique.mockResolvedValue({ user: makeUserDoc() });
      await service.oauthLogin(profile);
      expect(eventEmitter.emit).not.toHaveBeenCalledWith('user.created', expect.anything());
    });

    it('throws ForbiddenException when user is deactivated', async () => {
      const { service, prisma } = makeService();
      prisma.oauthProvider.findUnique.mockResolvedValue({ user: makeUserDoc({ isActive: false }) });
      await expect(service.oauthLogin(profile)).rejects.toThrow(ForbiddenException);
    });

    it('returns pending 2FA token when user has 2FA enabled', async () => {
      const { service, prisma } = makeService();
      prisma.oauthProvider.findUnique.mockResolvedValue({
        user: makeUserDoc({ isTwoFactorEnabled: true }),
      });
      const result = await service.oauthLogin(profile);
      expect((result.auth as any).isTwoFactorPending).toBe(true);
      expect(result.auth.accessToken).toBe('mock-pending-token');
      expect(result.refreshToken).toBe('');
    });

    it('throws ConflictException when user.create throws P2002', async () => {
      const { service, prisma } = makeService();
      const noEmailProfile = { provider: 'github', providerId: 'ghid-456', displayName: 'GH User' };
      prisma.oauthProvider.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(makeP2002());
      await expect(service.oauthLogin(noEmailProfile)).rejects.toThrow(ConflictException);
    });

    it('re-throws non-P2025 errors from user.update', async () => {
      const { service, prisma } = makeService();
      prisma.oauthProvider.findUnique.mockResolvedValue(null);
      prisma.user.update.mockRejectedValue(new Error('DB error'));
      await expect(service.oauthLogin(profile)).rejects.toThrow('DB error');
    });
  });

  // ── issueTokens ───────────────────────────────────────────────────────────────

  describe('issueTokens()', () => {
    it('returns full auth for active user', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUserDoc());
      const result = await service.issueTokens('user-id-1');
      expect(result.auth.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(result.auth.user).toBeDefined();
    });

    it('queries by userId with required select fields', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUserDoc());
      await service.issueTokens('user-id-1');
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-id-1' } }),
      );
    });

    it('throws NotFoundException when user not found', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.issueTokens('ghost-id')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when user is inactive', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUserDoc({ isActive: false }));
      await expect(service.issueTokens('user-id-1')).rejects.toThrow(NotFoundException);
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
