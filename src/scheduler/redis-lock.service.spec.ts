import { Test, TestingModule } from '@nestjs/testing';
import { RedisLockService } from './redis-lock.service';
import { RedisClientService } from '../redis/redis-client.service';

const makeRedisMock = () => ({
  set: jest.fn(),
  eval: jest.fn(),
});

const makeRedisClientServiceMock = () => ({
  client: makeRedisMock(),
});

describe('RedisLockService', () => {
  let service: RedisLockService;
  let redis: ReturnType<typeof makeRedisMock>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const redisClientService = makeRedisClientServiceMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisLockService,
        { provide: RedisClientService, useValue: redisClientService },
      ],
    }).compile();
    service = module.get(RedisLockService);
    redis = redisClientService.client;
  });

  // ── acquire ────────────────────────────────────────────────────────────────

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

    it('uses default TTL of 30 seconds when not specified', async () => {
      redis.set.mockResolvedValue('OK');
      await service.acquire('my-lock');
      expect(redis.set).toHaveBeenCalledWith('lock:my-lock', expect.any(String), 'EX', 30, 'NX');
    });

    it('prefixes key with "lock:" to namespace from other Redis keys', async () => {
      redis.set.mockResolvedValue('OK');
      await service.acquire('cleanup:tokens', 60);
      expect(redis.set).toHaveBeenCalledWith('lock:cleanup:tokens', expect.any(String), 'EX', 60, 'NX');
    });
  });

  // ── release ────────────────────────────────────────────────────────────────

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

    it('Lua script checks ownership before deleting', async () => {
      redis.eval.mockResolvedValue(1);
      await service.release('my-lock', 'token-xyz');
      const [script] = redis.eval.mock.calls[0];
      expect(script).toContain('ARGV[1]'); // script checks owner token
      expect(script).toContain('del');     // script deletes if match
    });
  });

  // ── withLock ───────────────────────────────────────────────────────────────

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

    it('uses default TTL of 30 when not specified', async () => {
      redis.set.mockResolvedValue('OK');
      redis.eval.mockResolvedValue(1);
      const fn = jest.fn().mockResolvedValue(null);
      await service.withLock('my-lock', fn);
      expect(redis.set).toHaveBeenCalledWith('lock:my-lock', expect.any(String), 'EX', 30, 'NX');
    });
  });
});
