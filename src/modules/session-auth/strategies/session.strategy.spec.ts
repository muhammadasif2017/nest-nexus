import { PrismaService } from '../../../prisma/prisma.service';
import { SessionSerializer } from './session.strategy';

const makePrismaMock = () => ({
  user: { findUnique: jest.fn() },
});

const makeSerializer = () => {
  const prisma = makePrismaMock();
  const serializer = new SessionSerializer(prisma as unknown as PrismaService);
  return { serializer, prisma };
};

describe('SessionSerializer', () => {
  describe('serializeUser()', () => {
    it('calls done with the user id', () => {
      const { serializer } = makeSerializer();
      const done = jest.fn();
      serializer.serializeUser({ id: 'user-id-1' }, done);
      expect(done).toHaveBeenCalledWith(null, 'user-id-1');
    });
  });

  describe('deserializeUser()', () => {
    it('looks up the user by id, selecting id/email/roles/isActive only', async () => {
      const { serializer, prisma } = makeSerializer();
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-id-1',
        email: 'test@example.com',
        roles: ['user'],
        isActive: true,
      });
      const done = jest.fn();
      await serializer.deserializeUser('user-id-1', done);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-id-1' },
        select: { id: true, email: true, roles: true, isActive: true },
      });
    });

    it('calls done with the user when found', async () => {
      const { serializer, prisma } = makeSerializer();
      const user = { id: 'user-id-1', email: 'test@example.com', roles: ['user'], isActive: true };
      prisma.user.findUnique.mockResolvedValue(user);
      const done = jest.fn();
      await serializer.deserializeUser('user-id-1', done);
      expect(done).toHaveBeenCalledWith(null, user);
    });

    it('calls done with false when user is not found', async () => {
      const { serializer, prisma } = makeSerializer();
      prisma.user.findUnique.mockResolvedValue(null);
      const done = jest.fn();
      await serializer.deserializeUser('missing-id', done);
      expect(done).toHaveBeenCalledWith(null, false);
    });

    it('calls done with the error and false when prisma throws', async () => {
      const { serializer, prisma } = makeSerializer();
      const error = new Error('db down');
      prisma.user.findUnique.mockRejectedValue(error);
      const done = jest.fn();
      await serializer.deserializeUser('user-id-1', done);
      expect(done).toHaveBeenCalledWith(error, false);
    });
  });
});
