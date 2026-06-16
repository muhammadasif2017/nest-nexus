import { Injectable, Logger } from '@nestjs/common';
import { RedisClientService } from '../redis/redis-client.service';
import crypto from 'crypto';

// Lua script for atomic compare-and-delete.
// Prevents a lock from being released by an instance that doesn't own it
// (e.g., if the owner's lock TTL expired and another instance acquired it).
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(private readonly redisClient: RedisClientService) {}

  // Acquire a distributed lock. Returns the lock token if acquired, null if not.
  // ttlSeconds: how long the lock lives even if the holder crashes (prevents deadlock).
  async acquire(key: string, ttlSeconds = 30): Promise<string | null> {
    const token = crypto.randomUUID();
    const result = await this.redisClient.client.set(`lock:${key}`, token, 'EX', ttlSeconds, 'NX');
    return result === 'OK' ? token : null;
  }

  // Release a lock. Only releases if this instance still owns it (Lua atomic check).
  async release(key: string, token: string): Promise<void> {
    await this.redisClient.client.eval(RELEASE_SCRIPT, 1, `lock:${key}`, token);
  }

  // Execute a function under a distributed lock. Skips silently if lock not acquired
  // (another instance is already running). Use for scheduled jobs — not for user requests.
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds = 30,
  ): Promise<T | null> {
    const token = await this.acquire(key, ttlSeconds);
    if (!token) {
      this.logger.debug(`Lock "${key}" held by another instance — skipping`);
      return null;
    }

    try {
      return await fn();
    } finally {
      await this.release(key, token);
    }
  }
}
