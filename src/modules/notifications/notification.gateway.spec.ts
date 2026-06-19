import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationGateway } from './notification.gateway';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

const makeJwtServiceMock = () => ({ verify: jest.fn() });
const makeConfigMock = () => ({ get: jest.fn().mockReturnValue('test-secret') });

const makeServerMock = () => {
  const toEmit = jest.fn();
  const disconnectSockets = jest.fn();
  return {
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: toEmit }),
    in: jest.fn().mockReturnValue({ disconnectSockets }),
    _toEmit: toEmit,
    _disconnectSockets: disconnectSockets,
  };
};

const makeGateway = () => {
  const jwtService = makeJwtServiceMock();
  const config = makeConfigMock();
  const gateway = new NotificationGateway(
    jwtService as unknown as JwtService,
    config as unknown as ConfigService,
  );
  const server = makeServerMock();
  (gateway as unknown as { server: unknown }).server = server;
  return { gateway, jwtService, config, server };
};

const makeClient = (overrides: Record<string, unknown> = {}) => ({
  handshake: { auth: {}, headers: {} },
  data: {},
  emit: jest.fn(),
  disconnect: jest.fn(),
  join: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const makePayload = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: 'user-id-1',
  email: 'test@example.com',
  roles: ['user'],
  ...overrides,
});

describe('NotificationGateway', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handleConnection()', () => {
    it('emits error and disconnects when no token is provided', async () => {
      const { gateway } = makeGateway();
      const client = makeClient();
      await gateway.handleConnection(client as any);
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('Unauthorized') }),
      );
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('accepts a token from handshake.auth.token', async () => {
      const { gateway, jwtService, client } = (() => {
        const ctx = makeGateway();
        const client = makeClient({ handshake: { auth: { token: 'tok' }, headers: {} } });
        return { ...ctx, client };
      })();
      jwtService.verify.mockReturnValue(makePayload());
      await gateway.handleConnection(client as any);
      expect(client.data.userId).toBe('user-id-1');
      expect(client.join).toHaveBeenCalledWith('user:user-id-1');
    });

    it('falls back to the Authorization header when auth.token is absent', async () => {
      const { gateway, jwtService } = makeGateway();
      const client = makeClient({
        handshake: { auth: {}, headers: { authorization: 'Bearer header-token' } },
      });
      jwtService.verify.mockReturnValue(makePayload());
      await gateway.handleConnection(client as any);
      expect(jwtService.verify).toHaveBeenCalledWith('header-token', expect.anything());
    });

    it('joins the user-scoped room on success', async () => {
      const { gateway, jwtService } = makeGateway();
      const client = makeClient({ handshake: { auth: { token: 'tok' }, headers: {} } });
      jwtService.verify.mockReturnValue(makePayload({ sub: 'distinct-id' }));
      await gateway.handleConnection(client as any);
      expect(client.join).toHaveBeenCalledWith('user:distinct-id');
    });

    it('rejects tokens with two_factor_pending scope', async () => {
      const { gateway, jwtService } = makeGateway();
      const client = makeClient({ handshake: { auth: { token: 'tok' }, headers: {} } });
      jwtService.verify.mockReturnValue(makePayload({ scope: 'two_factor_pending' }));
      await gateway.handleConnection(client as any);
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('invalid token') }),
      );
      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('emits error and disconnects when verification throws', async () => {
      const { gateway, jwtService } = makeGateway();
      const client = makeClient({ handshake: { auth: { token: 'bad' }, headers: {} } });
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });
      await gateway.handleConnection(client as any);
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('invalid token') }),
      );
      expect(client.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleDisconnect()', () => {
    it('does not throw for a client with no userId set', () => {
      const { gateway } = makeGateway();
      expect(() => gateway.handleDisconnect(makeClient() as any)).not.toThrow();
    });

    it('does not throw for a client with userId set', () => {
      const { gateway } = makeGateway();
      const client = makeClient({ data: { userId: 'user-id-1' } });
      expect(() => gateway.handleDisconnect(client as any)).not.toThrow();
    });
  });

  describe('sendToUser()', () => {
    it('emits to the user-scoped room with a typed payload', () => {
      const { gateway, server } = makeGateway();
      gateway.sendToUser('user-id-1', 'custom-event', { foo: 'bar' });
      expect(server.to).toHaveBeenCalledWith('user:user-id-1');
      expect(server._toEmit).toHaveBeenCalledWith(
        'custom-event',
        expect.objectContaining({ type: 'custom-event', data: { foo: 'bar' } }),
      );
    });
  });

  describe('broadcast()', () => {
    it('emits to all connected clients with a typed payload', () => {
      const { gateway, server } = makeGateway();
      gateway.broadcast('announcement', { msg: 'hi' });
      expect(server.emit).toHaveBeenCalledWith(
        'announcement',
        expect.objectContaining({ type: 'announcement', data: { msg: 'hi' } }),
      );
    });
  });

  describe('handlePing()', () => {
    it('replies with pong', () => {
      const { gateway } = makeGateway();
      const client = makeClient();
      gateway.handlePing(client as any);
      expect(client.emit).toHaveBeenCalledWith(
        'pong',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });
  });

  describe('handleJoinRoom()', () => {
    it('joins when the requested room matches the client own room', async () => {
      const { gateway } = makeGateway();
      const client = makeClient({ data: { userId: 'user-id-1' } });
      await gateway.handleJoinRoom(client as any, { room: 'user:user-id-1' });
      expect(client.join).toHaveBeenCalledWith('user:user-id-1');
      expect(client.emit).toHaveBeenCalledWith('room:joined', { room: 'user:user-id-1' });
    });

    it('does not join when the requested room belongs to another user', async () => {
      const { gateway } = makeGateway();
      const client = makeClient({ data: { userId: 'user-id-1' } });
      await gateway.handleJoinRoom(client as any, { room: 'user:other-user' });
      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalledWith('room:joined', expect.anything());
    });

    it('is a no-op when no room is given', async () => {
      const { gateway } = makeGateway();
      const client = makeClient({ data: { userId: 'user-id-1' } });
      await gateway.handleJoinRoom(client as any, { room: '' } as any);
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('onUserUpdated()', () => {
    it('forwards a user:updated event to the affected user', () => {
      const { gateway, server } = makeGateway();
      gateway.onUserUpdated({ userId: 'user-id-1' });
      expect(server.to).toHaveBeenCalledWith('user:user-id-1');
      expect(server._toEmit).toHaveBeenCalledWith('user:updated', expect.anything());
    });
  });

  describe('onUserDeactivated()', () => {
    it('forwards a user:deactivated event and force-disconnects the user room', () => {
      const { gateway, server } = makeGateway();
      gateway.onUserDeactivated({ userId: 'user-id-1' });
      expect(server._toEmit).toHaveBeenCalledWith('user:deactivated', expect.anything());
      expect(server.in).toHaveBeenCalledWith('user:user-id-1');
      expect(server._disconnectSockets).toHaveBeenCalledWith(true);
    });
  });

  describe('onUserCreated()', () => {
    it('notifies the admin room', () => {
      const { gateway, server } = makeGateway();
      gateway.onUserCreated({ userId: 'user-id-1' });
      expect(server.to).toHaveBeenCalledWith('admin');
      expect(server._toEmit).toHaveBeenCalledWith('user:created', expect.anything());
    });
  });
});
