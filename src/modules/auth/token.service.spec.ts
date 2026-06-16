import 'reflect-metadata';
import crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenService } from './token.service';
import { PrismaService } from '../../prisma/prisma.service';

// ── Hash helpers — mirrors TokenService.hashRefreshToken (SHA-256) ────────────
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// The JWT mock always returns this string, so we can precompute its hash
const SIGNED_JWT = 'signed.jwt.token';
const SIGNED_JWT_HASH = sha256(SIGNED_JWT);

// Known raw token used in rotateRefreshToken tests
const RAW_TOKEN = 'raw.token';
const RAW_TOKEN_HASH = sha256(RAW_TOKEN);

// ── Mock factories ────────────────────────────────────────────────────────────

const makeJwtServiceMock = () => ({
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
  verify: jest.fn(),
});

const makeConfigMock = () => ({
  get: jest.fn().mockImplementation((key: string) => {
    const map: Record<string, string> = {
      'jwt.secret': 'test-access-secret',
      'jwt.expiresIn': '15m',
      'jwt.refreshSecret': 'test-refresh-secret',
      'jwt.refreshExpiresIn': '7d',
      'app.nodeEnv': 'test',
    };
    return map[key] ?? null;
  }),
});

const makePrismaMock = () => ({
  user: {
    findUnique: jest.fn(),
  },
  refreshToken: {
    create: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
});

type Context = ReturnType<typeof makeService>;

const makeService = () => {
  const jwtService = makeJwtServiceMock();
  const config = makeConfigMock();
  const prisma = makePrismaMock();
  const service = new TokenService(
    jwtService as unknown as JwtService,
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
  );
  return { service, jwtService, config, prisma };
};

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-id-1',
  email: 'test@example.com',
  roles: ['user'],
  isActive: true,
  ...overrides,
});

const makeRefreshToken = (overrides: Record<string, unknown> = {}) => ({
  id: 'rt-id-1',
  userId: 'user-id-1',
  tokenHash: 'hashed-old-token',
  jti: 'jti-1',
  family: 'family-1',
  isRevoked: false,
  deviceId: 'device-id-1',
  deviceName: 'Windows Device',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
  lastUsedAt: new Date('2024-01-15T10:00:00Z'),
  createdAt: new Date('2024-01-01T10:00:00Z'),
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  ...overrides,
});

const makeRefreshPayload = (overrides: Record<string, unknown> = {}) => ({
  sub: 'user-id-1',
  jti: 'jti-1',
  family: 'family-1',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TokenService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = makeService();
  });

  // ── generateAccessToken ───────────────────────────────────────────────────

  describe('generateAccessToken()', () => {
    it('calls jwtService.sign with correct payload', () => {
      const user = makeUser();
      ctx.service.generateAccessToken(user);
      expect(ctx.jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-id-1', email: 'test@example.com', roles: ['user'] },
        expect.objectContaining({ secret: 'test-access-secret' }),
      );
    });

    it('returns the signed JWT string', () => {
      ctx.jwtService.sign.mockReturnValue('access.jwt.value');
      const token = ctx.service.generateAccessToken(makeUser());
      expect(token).toBe('access.jwt.value');
    });

    it('includes roles array in payload', () => {
      ctx.service.generateAccessToken(makeUser({ roles: ['user', 'admin'] }));
      const [payload] = ctx.jwtService.sign.mock.calls[0];
      expect(payload.roles).toEqual(['user', 'admin']);
    });

    it('uses user.id as sub claim', () => {
      ctx.service.generateAccessToken({ id: 'exact-id', email: 'e@e.com', roles: [] });
      const [payload] = ctx.jwtService.sign.mock.calls[0];
      expect(payload.sub).toBe('exact-id');
    });
  });

  // ── generateRefreshToken ──────────────────────────────────────────────────

  describe('generateRefreshToken()', () => {
    it('calls prisma.refreshToken.create with tokenHash and userId', async () => {
      await ctx.service.generateRefreshToken('user-id-1');
      expect(ctx.prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-id-1', tokenHash: SIGNED_JWT_HASH }),
        }),
      );
    });

    it('stores jti and family in the DB record', async () => {
      await ctx.service.generateRefreshToken('user-id-1');
      const { data } = ctx.prisma.refreshToken.create.mock.calls[0][0];
      expect(data.jti).toBeDefined();
      expect(data.family).toBeDefined();
    });

    it('uses existingFamily option when provided', async () => {
      await ctx.service.generateRefreshToken('user-id-1', { existingFamily: 'my-family' });
      const { data } = ctx.prisma.refreshToken.create.mock.calls[0][0];
      expect(data.family).toBe('my-family');
    });

    it('stores deviceName from parsed userAgent', async () => {
      await ctx.service.generateRefreshToken('user-id-1', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      });
      const { data } = ctx.prisma.refreshToken.create.mock.calls[0][0];
      expect(data.deviceName).toBe('Windows Device');
    });

    it('stores userAgent string in DB', async () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)';
      await ctx.service.generateRefreshToken('user-id-1', { userAgent: ua });
      const { data } = ctx.prisma.refreshToken.create.mock.calls[0][0];
      expect(data.userAgent).toBe(ua);
    });

    it('returns the raw (unhashed) JWT token string', async () => {
      ctx.jwtService.sign.mockReturnValue('raw.refresh.token');
      const result = await ctx.service.generateRefreshToken('user-id-1');
      expect(result).toBe('raw.refresh.token');
    });

    it('uses deviceId option when provided', async () => {
      await ctx.service.generateRefreshToken('user-id-1', { deviceId: 'my-device-id' });
      const { data } = ctx.prisma.refreshToken.create.mock.calls[0][0];
      expect(data.deviceId).toBe('my-device-id');
    });
  });

  // ── rotateRefreshToken ────────────────────────────────────────────────────

  describe('rotateRefreshToken()', () => {
    const setupHappyPath = (c: Context) => {
      // tokenHash must match SHA256(rawToken) for the service to find the token
      const rt = makeRefreshToken({ tokenHash: RAW_TOKEN_HASH });
      c.jwtService.verify.mockReturnValue(makeRefreshPayload());
      c.prisma.user.findUnique.mockResolvedValue(makeUser());
      c.prisma.refreshToken.findMany.mockResolvedValue([rt]);
      return rt;
    };

    // ── Step 1: JWT verification ──────────────────────────────────────────

    it('throws UnauthorizedException when JWT is invalid', async () => {
      ctx.jwtService.verify.mockImplementation(() => { throw new Error('expired'); });
      await expect(ctx.service.rotateRefreshToken('bad.token')).rejects.toThrow(UnauthorizedException);
    });

    it('verifies JWT with refreshSecret', async () => {
      setupHappyPath(ctx);
      await ctx.service.rotateRefreshToken(RAW_TOKEN);
      expect(ctx.jwtService.verify).toHaveBeenCalledWith(RAW_TOKEN, {
        secret: 'test-refresh-secret',
      });
    });

    // ── Step 2: User lookup ───────────────────────────────────────────────

    it('throws UnauthorizedException when user is not found', async () => {
      ctx.jwtService.verify.mockReturnValue(makeRefreshPayload());
      ctx.prisma.user.findUnique.mockResolvedValue(null);
      await expect(ctx.service.rotateRefreshToken(RAW_TOKEN)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user is inactive', async () => {
      ctx.jwtService.verify.mockReturnValue(makeRefreshPayload());
      ctx.prisma.user.findUnique.mockResolvedValue(makeUser({ isActive: false }));
      await expect(ctx.service.rotateRefreshToken(RAW_TOKEN)).rejects.toThrow(UnauthorizedException);
    });

    it('queries user by sub from JWT payload', async () => {
      setupHappyPath(ctx);
      await ctx.service.rotateRefreshToken(RAW_TOKEN);
      expect(ctx.prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-id-1' } }),
      );
    });

    // ── Step 3: Token hash matching ───────────────────────────────────────

    it('throws UnauthorizedException when no family tokens exist', async () => {
      ctx.jwtService.verify.mockReturnValue(makeRefreshPayload());
      ctx.prisma.user.findUnique.mockResolvedValue(makeUser());
      ctx.prisma.refreshToken.findMany.mockResolvedValue([]);
      await expect(ctx.service.rotateRefreshToken(RAW_TOKEN)).rejects.toThrow(UnauthorizedException);
    });

    it('revokes token family and throws when hash does not match (reuse detection)', async () => {
      ctx.jwtService.verify.mockReturnValue(makeRefreshPayload());
      ctx.prisma.user.findUnique.mockResolvedValue(makeUser());
      // tokenHash is 'hashed-old-token' — does NOT match SHA256(RAW_TOKEN), triggering reuse detection
      ctx.prisma.refreshToken.findMany.mockResolvedValue([makeRefreshToken()]);
      await expect(ctx.service.rotateRefreshToken(RAW_TOKEN)).rejects.toThrow(UnauthorizedException);
      expect(ctx.prisma.refreshToken.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-id-1', family: 'family-1' }),
        }),
      );
    });

    it('throws UnauthorizedException when matched token is already revoked', async () => {
      ctx.jwtService.verify.mockReturnValue(makeRefreshPayload());
      ctx.prisma.user.findUnique.mockResolvedValue(makeUser());
      // tokenHash matches RAW_TOKEN but token is revoked
      ctx.prisma.refreshToken.findMany.mockResolvedValue([makeRefreshToken({ tokenHash: RAW_TOKEN_HASH, isRevoked: true })]);
      await expect(ctx.service.rotateRefreshToken(RAW_TOKEN)).rejects.toThrow(UnauthorizedException);
    });

    // ── Ordering invariant: step 4 (revoke old) BEFORE step 5 (issue new) ─

    it('revokes old token BEFORE creating new token', async () => {
      setupHappyPath(ctx);
      const callOrder: string[] = [];
      ctx.prisma.refreshToken.update.mockImplementation(async () => { callOrder.push('update'); return {}; });
      ctx.prisma.refreshToken.create.mockImplementation(async () => { callOrder.push('create'); return {}; });

      await ctx.service.rotateRefreshToken(RAW_TOKEN);
      const updateIdx = callOrder.indexOf('update');
      const createIdx = callOrder.indexOf('create');
      expect(updateIdx).toBeGreaterThanOrEqual(0);
      expect(createIdx).toBeGreaterThanOrEqual(0);
      expect(updateIdx).toBeLessThan(createIdx);
    });

    it('marks old token as isRevoked via prisma.refreshToken.update', async () => {
      const rt = setupHappyPath(ctx);
      await ctx.service.rotateRefreshToken(RAW_TOKEN);
      expect(ctx.prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: rt.id }, data: { isRevoked: true } }),
      );
    });

    // ── Happy path ────────────────────────────────────────────────────────

    it('returns accessToken, refreshToken, and userId on success', async () => {
      setupHappyPath(ctx);
      const result = await ctx.service.rotateRefreshToken(RAW_TOKEN);
      expect(result).toMatchObject({
        userId: 'user-id-1',
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
    });

    it('preserves the existing token family in the new token', async () => {
      setupHappyPath(ctx);
      await ctx.service.rotateRefreshToken(RAW_TOKEN);
      const { data } = ctx.prisma.refreshToken.create.mock.calls[0][0];
      expect(data.family).toBe('family-1');
    });
  });

  // ── revokeAllTokens ───────────────────────────────────────────────────────

  describe('revokeAllTokens()', () => {
    it('calls prisma.refreshToken.deleteMany with userId', async () => {
      await ctx.service.revokeAllTokens('user-id-1');
      expect(ctx.prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-id-1' },
      });
    });
  });

  // ── listDeviceSessions ────────────────────────────────────────────────────

  describe('listDeviceSessions()', () => {
    it('returns empty array when no active tokens', async () => {
      ctx.prisma.refreshToken.findMany.mockResolvedValue([]);
      const result = await ctx.service.listDeviceSessions('user-id-1');
      expect(result).toEqual([]);
    });

    it('queries only non-revoked, non-expired tokens with a deviceId', async () => {
      ctx.prisma.refreshToken.findMany.mockResolvedValue([]);
      await ctx.service.listDeviceSessions('user-id-1');
      expect(ctx.prisma.refreshToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-id-1',
            isRevoked: false,
            deviceId: { not: null },
          }),
        }),
      );
    });

    it('deduplicates tokens by deviceId, keeping most recent', async () => {
      const older = makeRefreshToken({ lastUsedAt: new Date('2024-01-01') });
      const newer = makeRefreshToken({ id: 'rt-id-2', lastUsedAt: new Date('2024-01-10') });
      ctx.prisma.refreshToken.findMany.mockResolvedValue([older, newer]);
      const result = await ctx.service.listDeviceSessions('user-id-1');
      expect(result).toHaveLength(1);
      expect(result[0].lastUsedAt).toEqual(newer.lastUsedAt);
    });

    it('returns multiple entries for different deviceIds', async () => {
      const rt1 = makeRefreshToken({ deviceId: 'device-a' });
      const rt2 = makeRefreshToken({ id: 'rt-id-2', deviceId: 'device-b' });
      ctx.prisma.refreshToken.findMany.mockResolvedValue([rt1, rt2]);
      const result = await ctx.service.listDeviceSessions('user-id-1');
      expect(result).toHaveLength(2);
    });

    it('marks current device session with isCurrent=true', async () => {
      ctx.prisma.refreshToken.findMany.mockResolvedValue([makeRefreshToken()]);
      const result = await ctx.service.listDeviceSessions('user-id-1', 'device-id-1');
      expect(result[0].isCurrent).toBe(true);
    });

    it('marks non-current device session with isCurrent=false', async () => {
      ctx.prisma.refreshToken.findMany.mockResolvedValue([makeRefreshToken()]);
      const result = await ctx.service.listDeviceSessions('user-id-1', 'other-device');
      expect(result[0].isCurrent).toBe(false);
    });

    it('maps token fields to DeviceSessionOutput shape', async () => {
      const rt = makeRefreshToken();
      ctx.prisma.refreshToken.findMany.mockResolvedValue([rt]);
      const result = await ctx.service.listDeviceSessions('user-id-1');
      expect(result[0]).toMatchObject({
        deviceId: 'device-id-1',
        deviceName: 'Windows Device',
        lastUsedAt: rt.lastUsedAt,
        createdAt: rt.createdAt,
      });
    });
  });

  // ── revokeDeviceSession ───────────────────────────────────────────────────

  describe('revokeDeviceSession()', () => {
    it('calls prisma.refreshToken.deleteMany with userId and deviceId', async () => {
      await ctx.service.revokeDeviceSession('user-id-1', 'device-to-revoke');
      expect(ctx.prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-id-1', deviceId: 'device-to-revoke' },
      });
    });
  });

  // ── parseDeviceName ───────────────────────────────────────────────────────

  describe('parseDeviceName()', () => {
    const cases: [string | undefined, string][] = [
      [undefined, 'Unknown Device'],
      ['', 'Unknown Device'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)', 'iOS Device'],
      ['Mozilla/5.0 (iPad; CPU OS 14_0)', 'iOS Device'],
      ['Mozilla/5.0 (Linux; Android 10)', 'Android Device'],
      ['Mozilla/5.0 (Windows NT 10.0)', 'Windows Device'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'Mac Device'],
      ['Mozilla/5.0 (X11; Linux x86_64)', 'Linux Device'],
      ['some unknown bot/1.0', 'Unknown Device'],
    ];

    it.each(cases)('parseDeviceName(%p) → %s', (ua, expected) => {
      expect(ctx.service.parseDeviceName(ua)).toBe(expected);
    });
  });

  // ── getRefreshTokenCookieOptions ──────────────────────────────────────────

  describe('getRefreshTokenCookieOptions()', () => {
    it('returns httpOnly: true', () => {
      expect(ctx.service.getRefreshTokenCookieOptions().httpOnly).toBe(true);
    });

    it('returns secure: false in non-production', () => {
      expect(ctx.service.getRefreshTokenCookieOptions().secure).toBe(false);
    });

    it('returns secure: true in production', () => {
      ctx.config.get.mockImplementation((key: string) =>
        key === 'app.nodeEnv' ? 'production' : null,
      );
      expect(ctx.service.getRefreshTokenCookieOptions().secure).toBe(true);
    });

    it('returns sameSite: strict', () => {
      expect(ctx.service.getRefreshTokenCookieOptions().sameSite).toBe('strict');
    });

    it('returns path: /api/v1/auth', () => {
      expect(ctx.service.getRefreshTokenCookieOptions().path).toBe('/api/v1/auth');
    });
  });
});
