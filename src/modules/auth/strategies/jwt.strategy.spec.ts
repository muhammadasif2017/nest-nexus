import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy, JwtPayload } from './jwt.strategy';
import { PrismaService } from '../../../core/prisma/prisma.service';

const makeConfigMock = () => ({
  get: jest.fn().mockReturnValue('test-secret'),
});

const makePrismaMock = () => ({
  user: { findUnique: jest.fn() },
});

const makeStrategy = () => {
  const config = makeConfigMock();
  const prisma = makePrismaMock();
  const strategy = new JwtStrategy(
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
  );
  return { strategy, config, prisma };
};

const makePayload = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: 'user-id-1',
  email: 'test@example.com',
  roles: ['user'],
  ...overrides,
});

describe('JwtStrategy', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('validate()', () => {
    it('returns payload when user is active', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue({ isActive: true, roles: ['user'] });
      const payload = makePayload();
      const result = await strategy.validate(payload);
      expect(result).toEqual({ ...payload, roles: ['user'] });
    });

    it('overrides token roles with the DB roles (source of truth)', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue({ isActive: true, roles: ['admin'] });
      // Token still carries the old ['user'] roles; DB says admin now.
      const result = await strategy.validate(makePayload({ roles: ['user'] }));
      expect(result.roles).toEqual(['admin']);
    });

    it('queries prisma by payload.sub, selecting isActive and roles', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue({ isActive: true, roles: ['user'] });
      await strategy.validate(makePayload({ sub: 'distinct-id' }));
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'distinct-id' },
        select: { isActive: true, roles: true },
      });
    });

    it('throws UnauthorizedException when user is inactive', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue({ isActive: false });
      await expect(strategy.validate(makePayload())).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user is not found', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(strategy.validate(makePayload())).rejects.toThrow(UnauthorizedException);
    });

    it('does not re-query prisma on second call within cache TTL', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue({ isActive: true });
      const payload = makePayload();
      await strategy.validate(payload);
      await strategy.validate(payload);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('caches negative result and throws without re-querying on second call', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue({ isActive: false });
      const payload = makePayload();
      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('re-queries prisma after cache TTL expires', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue({ isActive: true });
      const payload = makePayload();
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      await strategy.validate(payload);
      jest.spyOn(Date, 'now').mockReturnValue(now + 30_001);
      await strategy.validate(payload);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it('caches per user id independently', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue({ isActive: true });
      await strategy.validate(makePayload({ sub: 'user-a' }));
      await strategy.validate(makePayload({ sub: 'user-b' }));
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateUserCache()', () => {
    it('forces re-query on next validate after invalidation', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue({ isActive: true });
      const payload = makePayload();
      await strategy.validate(payload);
      strategy.invalidateUserCache(payload.sub);
      await strategy.validate(payload);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('onUserChanged()', () => {
    it('invalidates the cache entry for the given userId', async () => {
      const { strategy, prisma } = makeStrategy();
      prisma.user.findUnique.mockResolvedValue({ isActive: true });
      const payload = makePayload();
      await strategy.validate(payload);
      strategy.onUserChanged({ userId: payload.sub });
      await strategy.validate(payload);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    });
  });
});
