import 'reflect-metadata';
import { UsersResolver } from './users.resolver';
import { UpdateUserInput } from './dto/update-user.input';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

// ── Factories ─────────────────────────────────────────────────────────────────

const mockUserOutput = {
  id: 'user-id-1',
  email: 'user@test.com',
  displayName: 'Test User',
  roles: ['user'],
  isEmailVerified: false,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

const makeServiceMock = () => ({
  findAll: jest.fn().mockResolvedValue([mockUserOutput]),
  findById: jest.fn().mockResolvedValue(mockUserOutput),
  update: jest.fn().mockResolvedValue(mockUserOutput),
  deactivate: jest.fn().mockResolvedValue({ ...mockUserOutput, isActive: false }),
});

const makeJwtUser = (sub = 'user-id-1'): JwtPayload => ({
  sub,
  email: 'user@test.com',
  roles: ['user'],
});

const makeResolver = () => {
  const usersService = makeServiceMock();
  const resolver = new UsersResolver(usersService as any);
  return { resolver, usersService };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('UsersResolver', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── findAll ──────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('delegates to usersService.findAll()', async () => {
      const { resolver, usersService } = makeResolver();

      await resolver.findAll();

      expect(usersService.findAll).toHaveBeenCalledTimes(1);
    });

    it('returns the service result', async () => {
      const { resolver } = makeResolver();

      const result = await resolver.findAll();

      expect(result).toEqual([mockUserOutput]);
    });
  });

  // ── getProfile ───────────────────────────────────────────────────────────────

  describe('getProfile()', () => {
    it('calls findById with user.sub', async () => {
      const { resolver, usersService } = makeResolver();
      const user = makeJwtUser('jwt-sub-id');

      await resolver.getProfile(user);

      expect(usersService.findById).toHaveBeenCalledWith('jwt-sub-id');
    });

    it('returns the service result', async () => {
      const { resolver } = makeResolver();

      const result = await resolver.getProfile(makeJwtUser());

      expect(result).toBe(mockUserOutput);
    });

    it('does not use email or roles from JWT — only sub', async () => {
      const { resolver, usersService } = makeResolver();
      const user: JwtPayload = { sub: 'correct-id', email: 'x@x.com', roles: ['admin'] };

      await resolver.getProfile(user);

      expect(usersService.findById).toHaveBeenCalledWith('correct-id');
      expect(usersService.findById).not.toHaveBeenCalledWith('x@x.com');
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('calls findById with the given id', async () => {
      const { resolver, usersService } = makeResolver();

      await resolver.findOne('some-user-id');

      expect(usersService.findById).toHaveBeenCalledWith('some-user-id');
    });

    it('returns the service result', async () => {
      const { resolver } = makeResolver();

      const result = await resolver.findOne('some-user-id');

      expect(result).toBe(mockUserOutput);
    });

    it('returns null when service returns null', async () => {
      const { resolver, usersService } = makeResolver();
      usersService.findById.mockResolvedValue(null);

      const result = await resolver.findOne('missing-id');

      expect(result).toBeNull();
    });
  });

  // ── updateProfile ─────────────────────────────────────────────────────────────

  describe('updateProfile()', () => {
    const input: UpdateUserInput = { displayName: 'Updated Name' };

    it('calls update with user.sub and input', async () => {
      const { resolver, usersService } = makeResolver();
      const user = makeJwtUser('user-to-update');

      await resolver.updateProfile(user, input);

      expect(usersService.update).toHaveBeenCalledWith('user-to-update', input);
    });

    it('returns the updated user output', async () => {
      const { resolver } = makeResolver();

      const result = await resolver.updateProfile(makeJwtUser(), input);

      expect(result).toBe(mockUserOutput);
    });

    it('uses sub not email to identify user being updated', async () => {
      const { resolver, usersService } = makeResolver();
      const user: JwtPayload = { sub: 'real-id', email: 'not-the-id@test.com', roles: [] };

      await resolver.updateProfile(user, input);

      expect(usersService.update).toHaveBeenCalledWith('real-id', input);
    });
  });

  // ── deactivateUser ────────────────────────────────────────────────────────────

  describe('deactivateUser()', () => {
    it('calls deactivate with the given id', async () => {
      const { resolver, usersService } = makeResolver();

      await resolver.deactivateUser('target-user-id');

      expect(usersService.deactivate).toHaveBeenCalledWith('target-user-id');
    });

    it('returns the deactivated user output', async () => {
      const { resolver } = makeResolver();

      const result = await resolver.deactivateUser('target-user-id');

      expect(result.isActive).toBe(false);
    });
  });
});
