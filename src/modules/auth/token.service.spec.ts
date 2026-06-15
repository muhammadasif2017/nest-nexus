import 'reflect-metadata';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service';

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn().mockReturnValue('fixed-uuid'),
}));

import bcrypt from 'bcrypt';
import crypto from 'crypto';

// ── Factories ─────────────────────────────────────────────────────────────────

const makeJwtServiceMock = () => ({
  sign: jest.fn().mockReturnValue('signed-token'),
  verify: jest.fn(),
});

const makeConfigMock = () => ({
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      'jwt.secret': 'test-jwt-secret',
      'jwt.expiresIn': '15m',
      'jwt.refreshSecret': 'test-refresh-secret',
      'jwt.refreshExpiresIn': '7d',
      'app.nodeEnv': 'test',
    };
    return map[key];
  }),
});

const makeRefreshToken = (overrides: Record<string, unknown> = {}) => ({
  tokenHash: '$2b$08$somehash',
  jti: 'jti-1',
  family: 'family-1',
  isRevoked: false,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  deviceId: 'device-1',
  deviceName: 'Windows Device',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
  lastUsedAt: new Date(Date.now() - 1000),
  createdAt: new Date(Date.now() - 2000),
  ...overrides,
});

const makeUserDoc = (tokens = [makeRefreshToken()], overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'user-id-1' },
  email: 'user@test.com',
  roles: ['user'],
  isActive: true,
  refreshTokens: tokens,
  ...overrides,
});

const makeModelMock = () => {
  const execForFind = jest.fn().mockResolvedValue(null);
  const lean = jest.fn().mockReturnValue({ exec: execForFind });
  const select = jest.fn().mockReturnValue({ exec: execForFind, lean });

  return {
    findById: jest.fn().mockReturnValue({ select }),
    findByIdAndUpdate: jest.fn().mockResolvedValue(null),
    _exec: execForFind,
    _select: select,
    _lean: lean,
  };
};

const makeService = () => {
  const jwtService = makeJwtServiceMock();
  const config = makeConfigMock();
  const model = makeModelMock();
  const service = new TokenService(jwtService as any, config as any, model as any);
  return { service, jwtService, config, model };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('TokenService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── generateAccessToken ───────────────────────────────────────────────────

  describe('generateAccessToken()', () => {
    const user = {
      _id: { toString: () => 'user-id-1' },
      email: 'user@test.com',
      roles: ['user', 'admin'],
    };

    it('calls jwtService.sign with correct payload', () => {
      const { service, jwtService } = makeService();

      service.generateAccessToken(user);

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-id-1', email: 'user@test.com', roles: ['user', 'admin'] },
        expect.objectContaining({ secret: 'test-jwt-secret' }),
      );
    });

    it('uses jwt.secret from config', () => {
      const { service, jwtService } = makeService();

      service.generateAccessToken(user);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ secret: 'test-jwt-secret' }),
      );
    });

    it('uses jwt.expiresIn from config', () => {
      const { service, jwtService } = makeService();

      service.generateAccessToken(user);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ expiresIn: '15m' }),
      );
    });

    it('returns the signed token string', () => {
      const { service } = makeService();

      const result = service.generateAccessToken(user);

      expect(result).toBe('signed-token');
    });

    it('converts _id to string in sub claim', () => {
      const { service, jwtService } = makeService();
      const userWithObjectId = { ...user, _id: { toString: () => 'object-id-string' } };

      service.generateAccessToken(userWithObjectId);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'object-id-string' }),
        expect.anything(),
      );
    });
  });

  // ── generateRefreshToken ──────────────────────────────────────────────────

  describe('generateRefreshToken()', () => {
    beforeEach(() => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$08$hashed');
    });

    it('signs JWT with refreshSecret', async () => {
      const { service, jwtService } = makeService();

      await service.generateRefreshToken('user-id-1');

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-id-1' }),
        expect.objectContaining({ secret: 'test-refresh-secret' }),
      );
    });

    it('signs JWT with refreshExpiresIn', async () => {
      const { service, jwtService } = makeService();

      await service.generateRefreshToken('user-id-1');

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ expiresIn: '7d' }),
      );
    });

    it('hashes raw token with bcrypt (8 rounds)', async () => {
      const { service, jwtService } = makeService();
      jwtService.sign.mockReturnValue('raw-token-value');

      await service.generateRefreshToken('user-id-1');

      expect(bcrypt.hash).toHaveBeenCalledWith('raw-token-value', 8);
    });

    it('stores token hash in DB via $push', async () => {
      const { service, model } = makeService();

      await service.generateRefreshToken('user-id-1');

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-1',
        expect.objectContaining({ $push: expect.objectContaining({ refreshTokens: expect.anything() }) }),
      );
    });

    it('uses existingFamily when provided', async () => {
      const { service, jwtService } = makeService();

      await service.generateRefreshToken('user-id-1', { existingFamily: 'existing-family-id' });

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ family: 'existing-family-id' }),
        expect.anything(),
      );
    });

    it('generates new family when not provided', async () => {
      const { service, jwtService } = makeService();
      (crypto.randomUUID as jest.Mock).mockReturnValueOnce('new-jti').mockReturnValueOnce('new-family');

      await service.generateRefreshToken('user-id-1');

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ family: 'new-family' }),
        expect.anything(),
      );
    });

    it('returns the raw (unhashed) token', async () => {
      const { service, jwtService } = makeService();
      jwtService.sign.mockReturnValue('raw-refresh-token');

      const result = await service.generateRefreshToken('user-id-1');

      expect(result).toBe('raw-refresh-token');
    });

    it('includes jti in token payload', async () => {
      const { service, jwtService } = makeService();
      (crypto.randomUUID as jest.Mock).mockReturnValue('fixed-jti');

      await service.generateRefreshToken('user-id-1');

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ jti: 'fixed-jti' }),
        expect.anything(),
      );
    });

    it('stores deviceName from parsed userAgent', async () => {
      const { service, model } = makeService();

      await service.generateRefreshToken('user-id-1', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      });

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-1',
        expect.objectContaining({
          $push: expect.objectContaining({
            refreshTokens: expect.objectContaining({ deviceName: 'Windows Device' }),
          }),
        }),
      );
    });
  });

  // ── rotateRefreshToken ────────────────────────────────────────────────────

  describe('rotateRefreshToken()', () => {
    const validPayload = { sub: 'user-id-1', jti: 'jti-1', family: 'family-1' };

    const setupHappyPath = (ctx: ReturnType<typeof makeService>) => {
      ctx.jwtService.verify.mockReturnValue(validPayload);
      ctx.model._exec.mockResolvedValue(makeUserDoc([makeRefreshToken()]));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$08$newhash');
      ctx.jwtService.sign.mockReturnValue('new-token');
    };

    // Step 1 — JWT verification
    describe('Step 1: JWT verification', () => {
      it('throws UnauthorizedException when token signature is invalid', async () => {
        const ctx = makeService();
        ctx.jwtService.verify.mockImplementation(() => { throw new Error('invalid signature'); });

        await expect(ctx.service.rotateRefreshToken('bad-token')).rejects.toThrow(UnauthorizedException);
      });

      it('throws UnauthorizedException when token is expired', async () => {
        const ctx = makeService();
        ctx.jwtService.verify.mockImplementation(() => { throw new Error('jwt expired'); });

        await expect(ctx.service.rotateRefreshToken('expired-token')).rejects.toThrow(UnauthorizedException);
      });

      it('uses jwt.refreshSecret to verify', async () => {
        const ctx = makeService();
        setupHappyPath(ctx);

        await ctx.service.rotateRefreshToken('valid-token');

        expect(ctx.jwtService.verify).toHaveBeenCalledWith(
          'valid-token',
          expect.objectContaining({ secret: 'test-refresh-secret' }),
        );
      });

      it('error message does not reveal whether token was expired vs tampered', async () => {
        const ctx = makeService();
        ctx.jwtService.verify.mockImplementation(() => { throw new Error('jwt expired'); });

        await expect(ctx.service.rotateRefreshToken('expired')).rejects.toThrow(
          'Invalid or expired refresh token.',
        );
      });
    });

    // Step 2 — User lookup
    describe('Step 2: User lookup', () => {
      it('throws UnauthorizedException when user not found', async () => {
        const ctx = makeService();
        ctx.jwtService.verify.mockReturnValue(validPayload);
        ctx.model._exec.mockResolvedValue(null);

        await expect(ctx.service.rotateRefreshToken('token')).rejects.toThrow(UnauthorizedException);
      });

      it('throws UnauthorizedException when user is inactive', async () => {
        const ctx = makeService();
        ctx.jwtService.verify.mockReturnValue(validPayload);
        ctx.model._exec.mockResolvedValue(makeUserDoc([], { isActive: false }));

        await expect(ctx.service.rotateRefreshToken('token')).rejects.toThrow(UnauthorizedException);
      });

      it('selects refreshTokens, email, roles, isActive fields', async () => {
        const ctx = makeService();
        setupHappyPath(ctx);

        await ctx.service.rotateRefreshToken('valid-token');

        expect(ctx.model._select).toHaveBeenCalledWith(
          '+refreshTokens email roles isActive',
        );
      });
    });

    // Step 3 — Hash matching
    describe('Step 3: Token hash matching', () => {
      it('calls bcrypt.compare for tokens in the same family', async () => {
        const ctx = makeService();
        setupHappyPath(ctx);

        await ctx.service.rotateRefreshToken('raw-token');

        expect(bcrypt.compare).toHaveBeenCalledWith('raw-token', '$2b$08$somehash');
      });

      it('does not compare tokens from a different family', async () => {
        const ctx = makeService();
        ctx.jwtService.verify.mockReturnValue({ ...validPayload, family: 'family-1' });
        ctx.model._exec.mockResolvedValue(
          makeUserDoc([makeRefreshToken({ family: 'different-family' })]),
        );
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        await expect(ctx.service.rotateRefreshToken('token')).rejects.toThrow();
        expect(bcrypt.compare).not.toHaveBeenCalled();
      });
    });

    // Step 4 — Reuse detection
    describe('Step 4: Reuse detection', () => {
      it('revokes the entire family when token already rotated (suspected theft)', async () => {
        const ctx = makeService();
        ctx.jwtService.verify.mockReturnValue(validPayload);
        // Family exists but bcrypt.compare returns false — token was already rotated out
        ctx.model._exec.mockResolvedValue(makeUserDoc([makeRefreshToken({ family: 'family-1' })]));
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        await expect(ctx.service.rotateRefreshToken('replayed-token')).rejects.toThrow(UnauthorizedException);

        expect(ctx.model.findByIdAndUpdate).toHaveBeenCalledWith(
          'user-id-1',
          { $pull: { refreshTokens: { family: 'family-1' } } },
        );
      });

      it('throws with reuse-specific message', async () => {
        const ctx = makeService();
        ctx.jwtService.verify.mockReturnValue(validPayload);
        ctx.model._exec.mockResolvedValue(makeUserDoc([makeRefreshToken({ family: 'family-1' })]));
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        await expect(ctx.service.rotateRefreshToken('replayed-token')).rejects.toThrow(
          'Refresh token has already been used.',
        );
      });

      it('does NOT revoke family when no family tokens exist at all', async () => {
        const ctx = makeService();
        ctx.jwtService.verify.mockReturnValue(validPayload);
        // No tokens in this family
        ctx.model._exec.mockResolvedValue(makeUserDoc([]));
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        await expect(ctx.service.rotateRefreshToken('unknown-token')).rejects.toThrow();

        // findByIdAndUpdate should NOT be called for $pull (revoke family)
        const pullCall = (ctx.model.findByIdAndUpdate as jest.Mock).mock.calls.find(
          ([, update]) => update.$pull?.refreshTokens?.family,
        );
        expect(pullCall).toBeUndefined();
      });
    });

    // Step 5 — Revoked check
    describe('Step 5: Explicit revocation check', () => {
      it('throws UnauthorizedException when matched token is revoked', async () => {
        const ctx = makeService();
        ctx.jwtService.verify.mockReturnValue(validPayload);
        ctx.model._exec.mockResolvedValue(
          makeUserDoc([makeRefreshToken({ isRevoked: true })]),
        );
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        await expect(ctx.service.rotateRefreshToken('token')).rejects.toThrow(
          'Refresh token has been revoked.',
        );
      });
    });

    // Step 6 & 7 — Rotation and ordering invariant
    describe('Step 6 & 7: Revoke old → issue new (ordering invariant)', () => {
      it('revokes old token BEFORE issuing new one', async () => {
        const ctx = makeService();
        setupHappyPath(ctx);
        (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$08$newhash');

        const callOrder: string[] = [];

        (ctx.model.findByIdAndUpdate as jest.Mock).mockImplementation((_id, update) => {
          if (update.$set?.['refreshTokens.$[elem].isRevoked'] !== undefined) callOrder.push('revoke');
          else if (update.$push?.refreshTokens) callOrder.push('issue');
          return Promise.resolve(null);
        });

        await ctx.service.rotateRefreshToken('raw-token');

        expect(callOrder[0]).toBe('revoke');
        expect(callOrder[1]).toBe('issue');
      });

      it('marks old token as revoked via arrayFilters', async () => {
        const ctx = makeService();
        setupHappyPath(ctx);

        await ctx.service.rotateRefreshToken('raw-token');

        expect(ctx.model.findByIdAndUpdate).toHaveBeenCalledWith(
          expect.anything(),
          { $set: { 'refreshTokens.$[elem].isRevoked': true } },
          { arrayFilters: [{ 'elem.tokenHash': '$2b$08$somehash' }] },
        );
      });

      it('issues new token in the same family', async () => {
        const ctx = makeService();
        setupHappyPath(ctx);

        await ctx.service.rotateRefreshToken('raw-token');

        // generateRefreshToken is called with existingFamily = payload.family
        expect(ctx.jwtService.sign).toHaveBeenCalledWith(
          expect.objectContaining({ family: 'family-1' }),
          expect.anything(),
        );
      });

      it('returns new accessToken, refreshToken, and userId', async () => {
        const ctx = makeService();
        setupHappyPath(ctx);
        ctx.jwtService.sign
          .mockReturnValueOnce('new-access-token')  // generateRefreshToken
          .mockReturnValueOnce('new-access-token'); // generateAccessToken

        const result = await ctx.service.rotateRefreshToken('raw-token');

        expect(result.userId).toBe('user-id-1');
        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();
      });
    });
  });

  // ── revokeAllTokens ───────────────────────────────────────────────────────

  describe('revokeAllTokens()', () => {
    it('clears refreshTokens array for the user', async () => {
      const { service, model } = makeService();

      await service.revokeAllTokens('user-id-1');

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-1',
        { $set: { refreshTokens: [] } },
      );
    });

    it('resolves without returning a value', async () => {
      const { service } = makeService();

      const result = await service.revokeAllTokens('user-id-1');

      expect(result).toBeUndefined();
    });
  });

  // ── getRefreshTokenCookieOptions ──────────────────────────────────────────

  describe('getRefreshTokenCookieOptions()', () => {
    it('sets httpOnly: true always', () => {
      const { service } = makeService();
      expect(service.getRefreshTokenCookieOptions().httpOnly).toBe(true);
    });

    it('sets sameSite: strict always', () => {
      const { service } = makeService();
      expect(service.getRefreshTokenCookieOptions().sameSite).toBe('strict');
    });

    it('sets path to /api/v1/auth', () => {
      const { service } = makeService();
      expect(service.getRefreshTokenCookieOptions().path).toBe('/api/v1/auth');
    });

    it('sets maxAge to 7 days in ms', () => {
      const { service } = makeService();
      expect(service.getRefreshTokenCookieOptions().maxAge).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('sets secure: false in non-production', () => {
      const { service, config } = makeService();
      config.get.mockReturnValue('test');

      expect(service.getRefreshTokenCookieOptions().secure).toBe(false);
    });

    it('sets secure: true in production', () => {
      const { service, config } = makeService();
      config.get.mockReturnValue('production');

      expect(service.getRefreshTokenCookieOptions().secure).toBe(true);
    });
  });

  // ── parseDeviceName ───────────────────────────────────────────────────────

  describe('parseDeviceName()', () => {
    it('returns Unknown Device when userAgent is undefined', () => {
      const { service } = makeService();
      expect(service.parseDeviceName(undefined)).toBe('Unknown Device');
    });

    it('returns iOS Device for iPhone', () => {
      const { service } = makeService();
      expect(service.parseDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iOS Device');
    });

    it('returns iOS Device for iPad', () => {
      const { service } = makeService();
      expect(service.parseDeviceName('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('iOS Device');
    });

    it('returns Android Device for Android UA', () => {
      const { service } = makeService();
      expect(service.parseDeviceName('Mozilla/5.0 (Linux; Android 14)')).toBe('Android Device');
    });

    it('returns Windows Device for Windows UA', () => {
      const { service } = makeService();
      expect(service.parseDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows Device');
    });

    it('returns Mac Device for Mac UA', () => {
      const { service } = makeService();
      expect(service.parseDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('Mac Device');
    });

    it('returns Linux Device for Linux UA (non-Android)', () => {
      const { service } = makeService();
      expect(service.parseDeviceName('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux Device');
    });

    it('returns Unknown Device for unrecognized UA', () => {
      const { service } = makeService();
      expect(service.parseDeviceName('CustomBot/1.0')).toBe('Unknown Device');
    });
  });

  // ── listDeviceSessions ────────────────────────────────────────────────────

  describe('listDeviceSessions()', () => {
    it('throws NotFoundException when user not found', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(null);

      await expect(service.listDeviceSessions('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('filters out revoked tokens', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue({
        refreshTokens: [
          makeRefreshToken({ isRevoked: true, deviceId: 'device-1' }),
          makeRefreshToken({ isRevoked: false, deviceId: 'device-2' }),
        ],
      });

      const result = await service.listDeviceSessions('user-id-1');

      expect(result).toHaveLength(1);
      expect(result[0].deviceId).toBe('device-2');
    });

    it('filters out expired tokens', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue({
        refreshTokens: [
          makeRefreshToken({ expiresAt: new Date(Date.now() - 1000), deviceId: 'expired' }),
          makeRefreshToken({ deviceId: 'active' }),
        ],
      });

      const result = await service.listDeviceSessions('user-id-1');

      expect(result).toHaveLength(1);
      expect(result[0].deviceId).toBe('active');
    });

    it('filters out tokens without deviceId', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue({
        refreshTokens: [
          makeRefreshToken({ deviceId: undefined }),
          makeRefreshToken({ deviceId: 'device-1' }),
        ],
      });

      const result = await service.listDeviceSessions('user-id-1');

      expect(result).toHaveLength(1);
    });

    it('deduplicates by deviceId keeping most recent lastUsedAt', async () => {
      const now = Date.now();
      const { service, model } = makeService();
      model._exec.mockResolvedValue({
        refreshTokens: [
          makeRefreshToken({ deviceId: 'device-1', lastUsedAt: new Date(now - 5000) }),
          makeRefreshToken({ deviceId: 'device-1', lastUsedAt: new Date(now - 1000) }),
        ],
      });

      const result = await service.listDeviceSessions('user-id-1');

      expect(result).toHaveLength(1);
      expect(result[0].lastUsedAt.getTime()).toBe(now - 1000);
    });

    it('sorts sessions by lastUsedAt descending', async () => {
      const now = Date.now();
      const { service, model } = makeService();
      model._exec.mockResolvedValue({
        refreshTokens: [
          makeRefreshToken({ deviceId: 'device-old', lastUsedAt: new Date(now - 10000) }),
          makeRefreshToken({ deviceId: 'device-new', lastUsedAt: new Date(now - 1000) }),
        ],
      });

      const result = await service.listDeviceSessions('user-id-1');

      expect(result[0].deviceId).toBe('device-new');
      expect(result[1].deviceId).toBe('device-old');
    });

    it('marks isCurrent true for the matching deviceId', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue({
        refreshTokens: [
          makeRefreshToken({ deviceId: 'this-device' }),
          makeRefreshToken({ deviceId: 'other-device', lastUsedAt: new Date(Date.now() - 5000) }),
        ],
      });

      const result = await service.listDeviceSessions('user-id-1', 'this-device');

      const current = result.find((s) => s.deviceId === 'this-device');
      const other = result.find((s) => s.deviceId === 'other-device');
      expect(current?.isCurrent).toBe(true);
      expect(other?.isCurrent).toBe(false);
    });

    it('returns empty array when no active sessions', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue({ refreshTokens: [] });

      const result = await service.listDeviceSessions('user-id-1');

      expect(result).toEqual([]);
    });
  });

  // ── revokeDeviceSession ───────────────────────────────────────────────────

  describe('revokeDeviceSession()', () => {
    it('pulls all tokens with matching deviceId', async () => {
      const { service, model } = makeService();

      await service.revokeDeviceSession('user-id-1', 'device-to-revoke');

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-1',
        { $pull: { refreshTokens: { deviceId: 'device-to-revoke' } } },
      );
    });

    it('resolves without returning a value', async () => {
      const { service } = makeService();

      const result = await service.revokeDeviceSession('user-id-1', 'device-1');

      expect(result).toBeUndefined();
    });
  });
});
