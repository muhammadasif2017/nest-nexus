import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserInput } from './dto/update-user.input';

// ── Raw DB document shape ─────────────────────────────────────────────────────

const makeRawUser = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'user-id-1' },
  email: 'user@test.com',
  displayName: 'Test User',
  roles: ['user'],
  isEmailVerified: false,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  password: 'hashed-secret',        // must be stripped by serialization
  refreshTokens: ['tok1', 'tok2'],  // must be stripped by serialization
  ...overrides,
});

// ── Mongoose mock builder ─────────────────────────────────────────────────────

const makeModelMock = () => {
  const exec = jest.fn();
  const lean = jest.fn().mockReturnValue({ exec });
  const select = jest.fn().mockReturnValue({ exec });

  const model = {
    find: jest.fn().mockReturnValue({ lean }),
    findOne: jest.fn().mockReturnValue({ select }),
    findByIdAndUpdate: jest.fn().mockReturnValue({ lean }),
    _exec: exec,     // shared exec — configure this for all queries
    _select: select, // exposed for call assertions only
  };

  return model;
};

// ── DataLoader mock ───────────────────────────────────────────────────────────

const makeLoaderMock = () => ({
  batchUsers: { load: jest.fn() },
});

// ── Factory ───────────────────────────────────────────────────────────────────

const makeService = () => {
  const model = makeModelMock();
  const loader = makeLoaderMock();
  const service = new UsersService(model as any, loader as any);
  return { service, model, loader };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('UsersService', () => {
  // ── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('queries only active users', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue([]);

      await service.findAll();

      expect(model.find).toHaveBeenCalledWith({ isActive: true });
    });

    it('returns empty array when no active users', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });

    it('returns array of UserOutput with exposed fields', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue([makeRawUser()]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('user@test.com');
      expect(result[0].displayName).toBe('Test User');
    });

    it('strips password from output', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue([makeRawUser()]);

      const result = await service.findAll();

      expect((result[0] as any).password).toBeUndefined();
    });

    it('strips refreshTokens from output', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue([makeRawUser()]);

      const result = await service.findAll();

      expect((result[0] as any).refreshTokens).toBeUndefined();
    });

    it('maps _id to id string via @Transform', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue([makeRawUser()]);

      const result = await service.findAll();

      expect(result[0].id).toBe('user-id-1');
    });

    it('returns multiple users', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue([
        makeRawUser({ _id: { toString: () => 'id-1' }, email: 'a@test.com' }),
        makeRawUser({ _id: { toString: () => 'id-2' }, email: 'b@test.com' }),
      ]);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].email).toBe('a@test.com');
      expect(result[1].email).toBe('b@test.com');
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('loads user via DataLoader', async () => {
      const { service, loader } = makeService();
      loader.batchUsers.load.mockResolvedValue(makeRawUser());

      await service.findById('user-id-1');

      expect(loader.batchUsers.load).toHaveBeenCalledWith('user-id-1');
    });

    it('returns UserOutput when user found', async () => {
      const { service, loader } = makeService();
      loader.batchUsers.load.mockResolvedValue(makeRawUser());

      const result = await service.findById('user-id-1');

      expect(result.email).toBe('user@test.com');
      expect(result.id).toBe('user-id-1');
    });

    it('throws NotFoundException when loader returns null', async () => {
      const { service, loader } = makeService();
      loader.batchUsers.load.mockResolvedValue(null);

      await expect(service.findById('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('includes the id in the NotFoundException message', async () => {
      const { service, loader } = makeService();
      loader.batchUsers.load.mockResolvedValue(null);

      await expect(service.findById('missing-id')).rejects.toThrow('missing-id');
    });

    it('strips password from returned UserOutput', async () => {
      const { service, loader } = makeService();
      loader.batchUsers.load.mockResolvedValue(makeRawUser());

      const result = await service.findById('user-id-1');

      expect((result as any).password).toBeUndefined();
    });
  });

  // ── findByEmail ───────────────────────────────────────────────────────────────

  describe('findByEmail()', () => {
    it('lowercases the email before querying', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeRawUser());

      await service.findByEmail('User@Test.COM');

      expect(model.findOne).toHaveBeenCalledWith({ email: 'user@test.com' });
    });

    it('selects +password field', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeRawUser());

      await service.findByEmail('user@test.com');

      expect(model._select).toHaveBeenCalledWith('+password');
    });

    it('returns the raw document (not a UserOutput)', async () => {
      const { service, model } = makeService();
      const rawUser = makeRawUser();
      model._exec.mockResolvedValue(rawUser);

      const result = await service.findByEmail('user@test.com');

      // Raw document includes password — this method is for auth use only
      expect(result).toBe(rawUser);
    });

    it('returns null when user not found', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(null);

      const result = await service.findByEmail('nobody@test.com');

      expect(result).toBeNull();
    });
  });

  // ── update ────────────────────────────────────────────────────────────────────

  describe('update()', () => {
    const dto: UpdateUserInput = { displayName: 'New Name' };

    it('calls findByIdAndUpdate with correct arguments', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeRawUser({ displayName: 'New Name' }));

      await service.update('user-id-1', dto);

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-1',
        { $set: dto },
        { new: true, runValidators: true },
      );
    });

    it('returns updated UserOutput', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeRawUser({ displayName: 'New Name' }));

      const result = await service.update('user-id-1', dto);

      expect(result.displayName).toBe('New Name');
    });

    it('throws NotFoundException when user not found', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(null);

      await expect(service.update('missing-id', dto)).rejects.toThrow(NotFoundException);
    });

    it('includes the id in the NotFoundException message', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(null);

      await expect(service.update('missing-id', dto)).rejects.toThrow('missing-id');
    });

    it('strips password from updated UserOutput', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeRawUser());

      const result = await service.update('user-id-1', dto);

      expect((result as any).password).toBeUndefined();
    });
  });

  // ── deactivate ────────────────────────────────────────────────────────────────

  describe('deactivate()', () => {
    it('sets isActive to false', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeRawUser({ isActive: false }));

      await service.deactivate('user-id-1');

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-1',
        { $set: { isActive: false } },
        { new: true, runValidators: true },
      );
    });

    it('returns UserOutput with isActive false', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(makeRawUser({ isActive: false }));

      const result = await service.deactivate('user-id-1');

      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException when user not found', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(null);

      await expect(service.deactivate('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('includes the id in the NotFoundException message', async () => {
      const { service, model } = makeService();
      model._exec.mockResolvedValue(null);

      await expect(service.deactivate('missing-id')).rejects.toThrow('missing-id');
    });
  });
});
