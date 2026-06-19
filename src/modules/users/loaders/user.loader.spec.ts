import { PrismaService } from '../../../core/prisma/prisma.service';
import { UserLoader } from './user.loader';

const makePrismaMock = () => ({
  user: { findMany: jest.fn() },
});

const makeLoader = () => {
  const prisma = makePrismaMock();
  const loader = new UserLoader(prisma as unknown as PrismaService);
  return { loader, prisma };
};

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-id-1',
  email: 'test@example.com',
  displayName: 'Test User',
  roles: ['user'],
  isEmailVerified: true,
  isActive: true,
  avatarUrl: null,
  lastLoginAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

describe('UserLoader', () => {
  describe('batchUsers', () => {
    it('returns the matching user for a single id', async () => {
      const { loader, prisma } = makeLoader();
      const user = makeUser();
      prisma.user.findMany.mockResolvedValue([user]);
      const result = await loader.batchUsers.load('user-id-1');
      expect(result).toEqual(user);
    });

    it('batches concurrent loads into a single findMany call', async () => {
      const { loader, prisma } = makeLoader();
      prisma.user.findMany.mockResolvedValue([
        makeUser({ id: 'user-a' }),
        makeUser({ id: 'user-b' }),
      ]);
      await Promise.all([loader.batchUsers.load('user-a'), loader.batchUsers.load('user-b')]);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    });

    it('queries with all requested ids via the in clause', async () => {
      const { loader, prisma } = makeLoader();
      prisma.user.findMany.mockResolvedValue([
        makeUser({ id: 'user-a' }),
        makeUser({ id: 'user-b' }),
      ]);
      await Promise.all([loader.batchUsers.load('user-a'), loader.batchUsers.load('user-b')]);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-a', 'user-b'] } },
        select: expect.objectContaining({ id: true, email: true }),
      });
    });

    it('returns null for ids with no matching user', async () => {
      const { loader, prisma } = makeLoader();
      prisma.user.findMany.mockResolvedValue([]);
      const result = await loader.batchUsers.load('missing-id');
      expect(result).toBeNull();
    });

    it('returns results in the same order as the requested ids', async () => {
      const { loader, prisma } = makeLoader();
      prisma.user.findMany.mockResolvedValue([
        makeUser({ id: 'user-b' }),
        makeUser({ id: 'user-a' }),
      ]);
      const [a, b] = await Promise.all([
        loader.batchUsers.load('user-a'),
        loader.batchUsers.load('user-b'),
      ]);
      expect(a?.id).toBe('user-a');
      expect(b?.id).toBe('user-b');
    });

    it('caches results so the same id is not refetched on a second load', async () => {
      const { loader, prisma } = makeLoader();
      prisma.user.findMany.mockResolvedValue([makeUser()]);
      await loader.batchUsers.load('user-id-1');
      await loader.batchUsers.load('user-id-1');
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
