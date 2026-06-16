import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisLockService } from './redis-lock.service';

// Mock ioredis — no real Redis in unit tests
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    eval: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  }));
});

const mockConfig = () => ({
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
      'redis.host': 'localhost',
      'redis.port': 6379,
      'redis.password': undefined,
    };
    return map[key];
  }),
});

describe('RedisLockService', () => {
  let service: RedisLockService;
  let redis: { set: jest.Mock; eval: jest.Mock; quit: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisLockService,
        { provide: ConfigService, useValue: mockConfig() },
      ],
    }).compile();
    service = module.get(RedisLockService);
    redis = (service as any).redis;
  });

  describe('acquire', () => {
    it('returns a token string when Redis SET NX succeeds', async () => {
      redis.set.mockResolvedValue('OK');
      const token = await service.acquire('my-lock', 30);
      expect(token).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(redis.set).toHaveBeenCalledWith('lock:my-lock', token, 'EX', 30, 'NX');
    });

    it('returns null when lock is already held (SET NX returns null)', async () => {
      redis.set.mockResolvedValue(null);
      const token = await service.acquire('my-lock', 30);
      expect(token).toBeNull();
    });
  });

  describe('release', () => {
    it('calls Lua eval with lock key and token', async () => {
      redis.eval.mockResolvedValue(1);
      await service.release('my-lock', 'token-123');
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get"'),
        1,
        'lock:my-lock',
        'token-123',
      );
    });

    it('does not throw when Lua returns 0 (lock already expired or wrong owner)', async () => {
      redis.eval.mockResolvedValue(0);
      await expect(service.release('my-lock', 'stale-token')).resolves.toBeUndefined();
    });
  });

  describe('withLock', () => {
    it('executes fn and releases lock when acquired', async () => {
      redis.set.mockResolvedValue('OK');
      redis.eval.mockResolvedValue(1);
      const fn = jest.fn().mockResolvedValue('result');

      const result = await service.withLock('my-lock', fn, 30);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(redis.eval).toHaveBeenCalledTimes(1); // release called
    });

    it('returns null and skips fn when lock not acquired', async () => {
      redis.set.mockResolvedValue(null); // lock held by another instance
      const fn = jest.fn();

      const result = await service.withLock('my-lock', fn, 30);

      expect(result).toBeNull();
      expect(fn).not.toHaveBeenCalled();
      expect(redis.eval).not.toHaveBeenCalled();
    });

    it('releases lock even when fn throws', async () => {
      redis.set.mockResolvedValue('OK');
      redis.eval.mockResolvedValue(1);
      const fn = jest.fn().mockRejectedValue(new Error('task failed'));

      await expect(service.withLock('my-lock', fn, 30)).rejects.toThrow('task failed');
      expect(redis.eval).toHaveBeenCalledTimes(1); // release still called in finally
    });
  });

  describe('onModuleDestroy', () => {
    it('calls quit on the Redis connection', async () => {
      await service.onModuleDestroy();
      expect(redis.quit).toHaveBeenCalled();
    });
  });
});
