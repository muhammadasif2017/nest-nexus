import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { CacheInvalidationService } from './cache-invalidation.service';

const redisInstances: any[] = [];

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    const instance = {
      subscribe: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
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

const makeCacheMock = () => ({ del: jest.fn().mockResolvedValue(undefined) });

const makeService = () => {
  redisInstances.length = 0;
  const cache = makeCacheMock();
  const config = makeConfigMock();
  const service = new CacheInvalidationService(
    cache as unknown as Cache,
    config as unknown as ConfigService,
  );
  const [publisher, subscriber] = redisInstances;
  return { service, cache, config, publisher, subscriber };
};

const getMessageHandler = (subscriber: any) =>
  subscriber.on.mock.calls.find(([event]: [string]) => event === 'message')[1];

describe('CacheInvalidationService', () => {
  describe('constructor', () => {
    it('creates two separate Redis connections (publisher and subscriber)', () => {
      const { publisher, subscriber } = makeService();
      expect(publisher).toBeDefined();
      expect(subscriber).toBeDefined();
      expect(publisher).not.toBe(subscriber);
    });
  });

  describe('onModuleInit()', () => {
    it('subscribes to the cache:invalidation channel', async () => {
      const { service, subscriber } = makeService();
      await service.onModuleInit();
      expect(subscriber.subscribe).toHaveBeenCalledWith('cache:invalidation');
    });

    it('invalidates local cache keys on a valid message', async () => {
      const { service, subscriber, cache } = makeService();
      await service.onModuleInit();
      const handler = getMessageHandler(subscriber);
      await handler('cache:invalidation', JSON.stringify({ keys: ['users:id:1', 'users:all'] }));
      expect(cache.del).toHaveBeenCalledWith('users:id:1');
      expect(cache.del).toHaveBeenCalledWith('users:all');
    });

    it('does not throw on a malformed message', async () => {
      const { service, subscriber } = makeService();
      await service.onModuleInit();
      const handler = getMessageHandler(subscriber);
      expect(() => handler('cache:invalidation', 'not-json')).not.toThrow();
    });

    it('does not call cache.del when the message is malformed', async () => {
      const { service, subscriber, cache } = makeService();
      await service.onModuleInit();
      const handler = getMessageHandler(subscriber);
      handler('cache:invalidation', 'not-json');
      expect(cache.del).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy()', () => {
    it('unsubscribes from the channel', async () => {
      const { service, subscriber } = makeService();
      await service.onModuleDestroy();
      expect(subscriber.unsubscribe).toHaveBeenCalledWith('cache:invalidation');
    });

    it('quits both the publisher and subscriber connections', async () => {
      const { service, publisher, subscriber } = makeService();
      await service.onModuleDestroy();
      expect(publisher.quit).toHaveBeenCalled();
      expect(subscriber.quit).toHaveBeenCalled();
    });
  });

  describe('onUserCreated()', () => {
    it('invalidates the users:all key locally', async () => {
      const { service, cache } = makeService();
      await service.onUserCreated();
      expect(cache.del).toHaveBeenCalledWith('users:all');
    });

    it('publishes the invalidated keys cross-instance', async () => {
      const { service, publisher } = makeService();
      await service.onUserCreated();
      expect(publisher.publish).toHaveBeenCalledWith(
        'cache:invalidation',
        JSON.stringify({ keys: ['users:all'] }),
      );
    });
  });

  describe('onUserUpdated()', () => {
    it('invalidates both the user-specific and users:all keys', async () => {
      const { service, cache } = makeService();
      await service.onUserUpdated({ userId: 'user-1' });
      expect(cache.del).toHaveBeenCalledWith('users:id:user-1');
      expect(cache.del).toHaveBeenCalledWith('users:all');
    });

    it('publishes both keys for cross-instance invalidation', async () => {
      const { service, publisher } = makeService();
      await service.onUserUpdated({ userId: 'user-1' });
      expect(publisher.publish).toHaveBeenCalledWith(
        'cache:invalidation',
        JSON.stringify({ keys: ['users:id:user-1', 'users:all'] }),
      );
    });
  });

  describe('onUserDeactivated()', () => {
    it('invalidates both the user-specific and users:all keys', async () => {
      const { service, cache } = makeService();
      await service.onUserDeactivated({ userId: 'user-1' });
      expect(cache.del).toHaveBeenCalledWith('users:id:user-1');
      expect(cache.del).toHaveBeenCalledWith('users:all');
    });
  });
});
