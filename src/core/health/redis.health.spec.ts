import { HealthCheckError } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';
import { RedisClientService } from '../redis/redis-client.service';

const makeRedisClientMock = () => ({
  client: { ping: jest.fn() },
});

const makeIndicator = () => {
  const redisClient = makeRedisClientMock();
  const indicator = new RedisHealthIndicator(redisClient as unknown as RedisClientService);
  return { indicator, redisClient };
};

describe('RedisHealthIndicator', () => {
  describe('isHealthy()', () => {
    it('returns an up status when ping succeeds', async () => {
      const { indicator, redisClient } = makeIndicator();
      redisClient.client.ping.mockResolvedValue('PONG');
      const result = await indicator.isHealthy('redis');
      expect(result).toEqual({ redis: { status: 'up' } });
    });

    it('throws HealthCheckError with a down status when ping fails', async () => {
      const { indicator, redisClient } = makeIndicator();
      redisClient.client.ping.mockRejectedValue(new Error('connection timeout'));
      await expect(indicator.isHealthy('redis')).rejects.toThrow(HealthCheckError);
    });

    it('includes the underlying error message in the down status', async () => {
      const { indicator, redisClient } = makeIndicator();
      redisClient.client.ping.mockRejectedValue(new Error('connection timeout'));
      await expect(indicator.isHealthy('redis')).rejects.toMatchObject({
        causes: { redis: { status: 'down', message: 'connection timeout' } },
      });
    });
  });
});
