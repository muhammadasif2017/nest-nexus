import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

const makeServiceMock = () => ({
  findAll: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  deactivate: jest.fn(),
});

const makeController = () => {
  const service = makeServiceMock();
  const controller = new UsersController(service as unknown as UsersService);
  return { controller, service };
};

const caller = { sub: 'user-1', email: 'a@test.com', roles: ['user'] } as unknown as JwtPayload;

describe('UsersController', () => {
  describe('getProfile()', () => {
    it('looks up the caller by their own id', async () => {
      const { controller, service } = makeController();
      service.findById.mockResolvedValue({ id: 'user-1' });
      await controller.getProfile(caller);
      expect(service.findById).toHaveBeenCalledWith('user-1');
    });
  });

  describe('findAll()', () => {
    it('delegates to service.findAll', async () => {
      const { controller, service } = makeController();
      service.findAll.mockResolvedValue([]);
      await controller.findAll();
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('findOne()', () => {
    it('returns the user when found', async () => {
      const { controller, service } = makeController();
      service.findById.mockResolvedValue({ id: 'user-2' });
      const result = await controller.findOne('user-2');
      expect(result).toEqual({ id: 'user-2' });
    });

    it('returns null when the user is not found', async () => {
      const { controller, service } = makeController();
      service.findById.mockRejectedValue(new NotFoundException());
      const result = await controller.findOne('missing');
      expect(result).toBeNull();
    });

    it('re-throws non-NotFound errors', async () => {
      const { controller, service } = makeController();
      service.findById.mockRejectedValue(new Error('DB down'));
      await expect(controller.findOne('x')).rejects.toThrow('DB down');
    });
  });

  describe('updateProfile()', () => {
    it('updates the caller using their own id', async () => {
      const { controller, service } = makeController();
      const input = { displayName: 'New Name' };
      service.update.mockResolvedValue({ id: 'user-1', displayName: 'New Name' });
      await controller.updateProfile(caller, input);
      expect(service.update).toHaveBeenCalledWith('user-1', input);
    });
  });

  describe('deactivateUser()', () => {
    it('delegates to service.deactivate with the target id', async () => {
      const { controller, service } = makeController();
      service.deactivate.mockResolvedValue({ id: 'user-9', isActive: false });
      await controller.deactivateUser('user-9');
      expect(service.deactivate).toHaveBeenCalledWith('user-9');
    });
  });
});
