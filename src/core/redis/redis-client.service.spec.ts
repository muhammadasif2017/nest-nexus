import { ConfigService } from '@nestjs/config';
import { RedisClientService } from './redis-client.service';

const redisInstances: any[] = [];

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    const instance = {
      status: 'wait',
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    redisInstances.push(instance);
    return instance;
  });
});

const makeConfigMock = () => ({
  get: jest.fn().mockImplementation((key: string) => {
    const map: Record<string, unknown> = {
      'redis.host': 'localhost',
      'redis.port': 6379,
      'redis.password': undefined,
    };
    return map[key];
  }),
});

const makeService = () => {
  redisInstances.length = 0;
  const config = makeConfigMock();
  const service = new RedisClientService(config as unknown as ConfigService);
  const [client] = redisInstances;
  return { service, client };
};

describe('RedisClientService', () => {
  describe('onModuleInit()', () => {
    it('connects the client', async () => {
      const { service, client } = makeService();
      await service.onModuleInit();
      expect(client.connect).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy()', () => {
    it('disconnects (not quit) when the client never connected (status: wait)', async () => {
      const { service, client } = makeService();
      client.status = 'wait';
      await service.onModuleDestroy();
      expect(client.disconnect).toHaveBeenCalled();
      expect(client.quit).not.toHaveBeenCalled();
    });

    it('disconnects (not quit) when the client has already ended (status: end)', async () => {
      const { service, client } = makeService();
      client.status = 'end';
      await service.onModuleDestroy();
      expect(client.disconnect).toHaveBeenCalled();
      expect(client.quit).not.toHaveBeenCalled();
    });

    it('quits gracefully when the client is connected (status: ready)', async () => {
      const { service, client } = makeService();
      client.status = 'ready';
      await service.onModuleDestroy();
      expect(client.quit).toHaveBeenCalled();
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });
});
