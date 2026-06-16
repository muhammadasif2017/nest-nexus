import { Test, TestingModule } from '@nestjs/testing';
import { CleanupScheduler } from './cleanup.scheduler';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisLockService } from '../redis-lock.service';

const mockPrisma = () => ({
  refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  oauthProvider: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
});

// withLock: immediately executes fn (no real Redis in unit tests)
const mockLock = () => ({
  withLock: jest.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
});

describe('CleanupScheduler', () => {
  let scheduler: CleanupScheduler;
  let prisma: ReturnType<typeof mockPrisma>;
  let lock: ReturnType<typeof mockLock>;

  beforeEach(async () => {
    prisma = mockPrisma();
    lock = mockLock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleanupScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisLockService, useValue: lock },
      ],
    }).compile();

    scheduler = module.get(CleanupScheduler);
  });

  describe('purgeExpiredTokens', () => {
    it('acquires the distributed lock', async () => {
      await scheduler.purgeExpiredTokens();
      expect(lock.withLock).toHaveBeenCalledWith(
        'cleanup:expired-tokens',
        expect.any(Function),
        300,
      );
    });

    it('deletes expired and revoked refresh tokens', async () => {
      await scheduler.purgeExpiredTokens();
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }),
      );
    });

    it('clears expired magic link tokens', async () => {
      await scheduler.purgeExpiredTokens();
      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { magicLinkTokenHash: null, magicLinkExpiresAt: null },
        }),
      );
    });

    it('clears expired email verification tokens', async () => {
      await scheduler.purgeExpiredTokens();
      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { emailVerificationToken: null, emailVerificationExpires: null },
        }),
      );
    });

    it('skips all work when lock is not acquired', async () => {
      lock.withLock.mockResolvedValue(null); // another instance holds lock
      await scheduler.purgeExpiredTokens();
      expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('purgeOrphanedOauthProviders', () => {
    it('acquires the distributed lock', async () => {
      await scheduler.purgeOrphanedOauthProviders();
      expect(lock.withLock).toHaveBeenCalledWith(
        'cleanup:orphaned-oauth',
        expect.any(Function),
        60,
      );
    });

    it('deletes OAuth providers for deactivated users', async () => {
      prisma.oauthProvider.deleteMany.mockResolvedValue({ count: 3 });
      await scheduler.purgeOrphanedOauthProviders();
      expect(prisma.oauthProvider.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user: { isActive: false } } }),
      );
    });

    it('skips all work when lock is not acquired', async () => {
      lock.withLock.mockResolvedValue(null);
      await scheduler.purgeOrphanedOauthProviders();
      expect(prisma.oauthProvider.deleteMany).not.toHaveBeenCalled();
    });
  });
});
