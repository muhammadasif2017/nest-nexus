import 'reflect-metadata';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { UpdateUserInput } from './dto/update-user.input';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ── Raw DB document shape (mirrors Prisma User) ───────────────────────────────

const makeRawUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-id-1',
  email: 'user@test.com',
  displayName: 'Test User',
  roles: ['user'],
  isEmailVerified: false,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  password: 'hashed-secret', // excluded by serialization
  ...overrides,
});

// ── Prisma mock builder ───────────────────────────────────────────────────────

const makePrismaMock = () => {
  const mock: any = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(makeRawUser()),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  // Interactive transaction: run the callback with the same mock as the tx client.
  mock.$transaction = jest.fn((cb: (tx: typeof mock) => unknown) => cb(mock));
  return mock;
};

const makeP2025 = () =>
  new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
    code: 'P2025',
    clientVersion: '7.0.0',
  });

// ── Factory ───────────────────────────────────────────────────────────────────

const makeEventEmitterMock = () => ({ emit: jest.fn() });
const makeCacheMock = () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
});

const makeService = () => {
  const prisma = makePrismaMock();
  const eventEmitter = makeEventEmitterMock();
  const cache = makeCacheMock();
  const service = new UsersService(
    prisma as unknown as PrismaService,
    eventEmitter as unknown as EventEmitter2,
    cache as any,
  );
  return { service, prisma, eventEmitter, cache };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('UsersService', () => {
  // ── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('queries only active users', async () => {
      const { service, prisma } = makeService();
      await service.findAll();
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        select: {
          id: true,
          email: true,
          displayName: true,
          roles: true,
          isEmailVerified: true,
          isActive: true,
          avatarUrl: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    it('returns empty array when no active users', async () => {
      const { service } = makeService();
      const result = await service.findAll();
      expect(result).toEqual([]);
    });

    it('returns array of UserOutput with exposed fields', async () => {
      const { service, prisma } = makeService();
      prisma.user.findMany.mockResolvedValue([makeRawUser()]);
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('user@test.com');
      expect(result[0].displayName).toBe('Test User');
    });

    it('strips password from output', async () => {
      const { service, prisma } = makeService();
      prisma.user.findMany.mockResolvedValue([makeRawUser()]);
      const result = await service.findAll();
      expect((result[0] as any).password).toBeUndefined();
    });

    it('maps id field correctly', async () => {
      const { service, prisma } = makeService();
      prisma.user.findMany.mockResolvedValue([makeRawUser()]);
      const result = await service.findAll();
      expect(result[0].id).toBe('user-id-1');
    });

    it('returns multiple users', async () => {
      const { service, prisma } = makeService();
      prisma.user.findMany.mockResolvedValue([
        makeRawUser({ id: 'id-1', email: 'a@test.com' }),
        makeRawUser({ id: 'id-2', email: 'b@test.com' }),
      ]);
      const result = await service.findAll();
      expect(result).toHaveLength(2);
      expect(result[0].email).toBe('a@test.com');
      expect(result[1].email).toBe('b@test.com');
    });

    it('returns cached value without hitting DB on cache hit', async () => {
      const { service, prisma, cache } = makeService();
      const cachedUsers = [makeRawUser()];
      cache.get.mockResolvedValue(cachedUsers);
      const result = await service.findAll();
      expect(result).toBe(cachedUsers);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('populates cache after DB query on cache miss', async () => {
      const { service, prisma, cache } = makeService();
      cache.get.mockResolvedValue(undefined);
      prisma.user.findMany.mockResolvedValue([makeRawUser()]);
      await service.findAll();
      expect(cache.set).toHaveBeenCalledWith('users:all', expect.any(Array));
    });

    it('reads cache with key "users:all"', async () => {
      const { service, cache } = makeService();
      await service.findAll();
      expect(cache.get).toHaveBeenCalledWith('users:all');
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('loads the user by id via prisma', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeRawUser());
      await service.findById('user-id-1');
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-id-1' } }),
      );
    });

    it('returns UserOutput when user found', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeRawUser());
      const result = await service.findById('user-id-1');
      expect(result.email).toBe('user@test.com');
      expect(result.id).toBe('user-id-1');
    });

    it('throws NotFoundException when prisma returns null', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findById('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('includes the id in the NotFoundException message', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findById('missing-id')).rejects.toThrow('missing-id');
    });

    it('strips password from returned UserOutput', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeRawUser());
      const result = await service.findById('user-id-1');
      expect((result as any).password).toBeUndefined();
    });

    it('returns cached value without hitting the DB on cache hit', async () => {
      const { service, prisma, cache } = makeService();
      const cachedUser = makeRawUser();
      cache.get.mockResolvedValue(cachedUser);
      const result = await service.findById('user-id-1');
      expect(result).toBe(cachedUser);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('populates cache after DB query on cache miss', async () => {
      const { service, prisma, cache } = makeService();
      cache.get.mockResolvedValue(undefined);
      prisma.user.findUnique.mockResolvedValue(makeRawUser());
      await service.findById('user-id-1');
      expect(cache.set).toHaveBeenCalledWith('users:id:user-id-1', expect.any(Object));
    });

    it('reads cache with key "users:id:<id>"', async () => {
      const { service, prisma, cache } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeRawUser());
      await service.findById('user-id-1');
      expect(cache.get).toHaveBeenCalledWith('users:id:user-id-1');
    });
  });

  // ── findByEmail ───────────────────────────────────────────────────────────────

  describe('findByEmail()', () => {
    it('lowercases the email before querying', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeRawUser());
      await service.findByEmail('User@Test.COM');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@test.com' },
      });
    });

    it('returns the raw document (not a UserOutput)', async () => {
      const { service, prisma } = makeService();
      const rawUser = makeRawUser();
      prisma.user.findUnique.mockResolvedValue(rawUser);
      const result = await service.findByEmail('user@test.com');
      expect(result).toBe(rawUser);
    });

    it('returns null when user not found', async () => {
      const { service } = makeService();
      const result = await service.findByEmail('nobody@test.com');
      expect(result).toBeNull();
    });

    it('includes password field in returned document', async () => {
      const { service, prisma } = makeService();
      const rawUser = makeRawUser({ password: '$2b$12$hashed' });
      prisma.user.findUnique.mockResolvedValue(rawUser);
      const result = (await service.findByEmail('user@test.com')) as any;
      expect(result.password).toBe('$2b$12$hashed');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────────

  describe('update()', () => {
    const dto: UpdateUserInput = { displayName: 'New Name' };

    it('calls prisma.user.update with correct arguments', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockResolvedValue(makeRawUser({ displayName: 'New Name' }));
      await service.update('user-id-1', dto);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id-1' },
        data: dto,
      });
    });

    it('returns updated UserOutput', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockResolvedValue(makeRawUser({ displayName: 'New Name' }));
      const result = await service.update('user-id-1', dto);
      expect(result.displayName).toBe('New Name');
    });

    it('throws NotFoundException when Prisma returns P2025', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockRejectedValue(makeP2025());
      await expect(service.update('missing-id', dto)).rejects.toThrow(NotFoundException);
    });

    it('includes the id in the NotFoundException message', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockRejectedValue(makeP2025());
      await expect(service.update('missing-id', dto)).rejects.toThrow('missing-id');
    });

    it('re-throws non-P2025 errors', async () => {
      const { service, prisma } = makeService();
      const unexpectedErr = new Error('DB connection lost');
      prisma.user.update.mockRejectedValue(unexpectedErr);
      await expect(service.update('user-id-1', dto)).rejects.toThrow('DB connection lost');
    });

    it('strips password from updated UserOutput', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockResolvedValue(makeRawUser());
      const result = await service.update('user-id-1', dto);
      expect((result as any).password).toBeUndefined();
    });

    it('emits user.updated event with userId after successful update', async () => {
      const { service, prisma, eventEmitter } = makeService();
      prisma.user.update.mockResolvedValue(makeRawUser());
      await service.update('user-id-1', dto);
      expect(eventEmitter.emit).toHaveBeenCalledWith('user.updated', { userId: 'user-id-1' });
    });

    it('does not emit user.updated event when update fails', async () => {
      const { service, prisma, eventEmitter } = makeService();
      prisma.user.update.mockRejectedValue(makeP2025());
      await expect(service.update('missing-id', dto)).rejects.toThrow();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // ── setRoles ──────────────────────────────────────────────────────────────────

  describe('setRoles()', () => {
    it('writes the new roles via prisma.user.update', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ roles: ['user'] });
      prisma.user.update.mockResolvedValue(makeRawUser({ roles: ['moderator'] }));
      await service.setRoles('user-id-1', ['moderator'] as any);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id-1' },
        data: { roles: ['moderator'] },
      });
    });

    it('returns updated UserOutput with new roles', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ roles: ['user'] });
      prisma.user.update.mockResolvedValue(makeRawUser({ roles: ['moderator'] }));
      const result = await service.setRoles('user-id-1', ['moderator'] as any);
      expect(result.roles).toEqual(['moderator']);
    });

    it('emits user.updated after a successful change', async () => {
      const { service, prisma, eventEmitter } = makeService();
      prisma.user.findUnique.mockResolvedValue({ roles: ['user'] });
      prisma.user.update.mockResolvedValue(makeRawUser({ roles: ['admin'] }));
      await service.setRoles('user-id-1', ['admin'] as any);
      expect(eventEmitter.emit).toHaveBeenCalledWith('user.updated', { userId: 'user-id-1' });
    });

    it('skips the last-super_admin check when new roles still include super_admin', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockResolvedValue(makeRawUser({ roles: ['super_admin'] }));
      await service.setRoles('user-id-1', ['super_admin'] as any);
      expect(prisma.user.count).not.toHaveBeenCalled();
    });

    it('throws ConflictException when demoting the last super_admin', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ roles: ['super_admin'] });
      prisma.user.count.mockResolvedValue(1);
      await expect(service.setRoles('user-id-1', ['admin'] as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows demoting a super_admin when others remain', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ roles: ['super_admin'] });
      prisma.user.count.mockResolvedValue(2);
      prisma.user.update.mockResolvedValue(makeRawUser({ roles: ['admin'] }));
      const result = await service.setRoles('user-id-1', ['admin'] as any);
      expect(result.roles).toEqual(['admin']);
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.setRoles('missing-id', ['admin'] as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('runs the check and write in a Serializable transaction', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ roles: ['user'] });
      prisma.user.update.mockResolvedValue(makeRawUser({ roles: ['moderator'] }));
      await service.setRoles('user-id-1', ['moderator'] as any);
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });
  });

  // ── deactivate ────────────────────────────────────────────────────────────────

  describe('deactivate()', () => {
    it('calls prisma.user.update with isActive: false', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockResolvedValue(makeRawUser({ isActive: false }));
      await service.deactivate('user-id-1');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id-1' },
        data: { isActive: false },
      });
    });

    it('returns UserOutput with isActive false', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockResolvedValue(makeRawUser({ isActive: false }));
      const result = await service.deactivate('user-id-1');
      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException when Prisma returns P2025', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockRejectedValue(makeP2025());
      await expect(service.deactivate('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('includes the id in the NotFoundException message', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockRejectedValue(makeP2025());
      await expect(service.deactivate('missing-id')).rejects.toThrow('missing-id');
    });

    it('emits user.deactivated event with userId after successful deactivation', async () => {
      const { service, prisma, eventEmitter } = makeService();
      prisma.user.update.mockResolvedValue(makeRawUser({ isActive: false }));
      await service.deactivate('user-id-1');
      expect(eventEmitter.emit).toHaveBeenCalledWith('user.deactivated', { userId: 'user-id-1' });
    });

    it('does not emit user.deactivated event when deactivation fails', async () => {
      const { service, prisma, eventEmitter } = makeService();
      prisma.user.update.mockRejectedValue(makeP2025());
      await expect(service.deactivate('missing-id')).rejects.toThrow();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
